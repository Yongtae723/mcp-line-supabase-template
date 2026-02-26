/**
 * OAuth utilities adapted from Cloudflare's workers-oauth-provider template.
 * Handles CSRF protection, state management, session binding, and approval dialogs.
 */

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

// ── CSRF Protection ──

export function generateCSRFProtection(): {
  token: string;
  setCookie: string;
} {
  const token = crypto.randomUUID();
  const setCookie = `__Host-csrf=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`;
  return { token, setCookie };
}

export class OAuthError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
  toResponse() {
    return new Response(this.message, { status: this.statusCode });
  }
}

export function validateCSRFToken(formData: FormData, request: Request) {
  const csrfToken = formData.get("csrf_token");
  if (!csrfToken || typeof csrfToken !== "string") {
    throw new OAuthError(400, "Missing CSRF token");
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const cookieToken = cookies["__Host-csrf"];
  if (!cookieToken || cookieToken !== csrfToken) {
    throw new OAuthError(403, "CSRF token mismatch");
  }
}

// ── OAuth State Management (KV-based) ──

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  ttl = 600,
): Promise<{ stateToken: string }> {
  const stateToken = crypto.randomUUID();
  await kv.put(
    `oauth_state:${stateToken}`,
    JSON.stringify(oauthReqInfo),
    { expirationTtl: ttl },
  );
  return { stateToken };
}

export async function bindStateToSession(stateToken: string): Promise<{
  setCookie: string;
}> {
  const hash = await sha256(stateToken);
  const setCookie = `__Host-session=${hash}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
  return { setCookie };
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<{ oauthReqInfo: AuthRequest; clearCookie: string }> {
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state");
  if (!stateToken) {
    throw new OAuthError(400, "Missing state parameter");
  }

  // Verify session binding
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const sessionHash = cookies["__Host-session"];
  if (!sessionHash) {
    throw new OAuthError(400, "Missing session cookie");
  }

  const expectedHash = await sha256(stateToken);
  if (sessionHash !== expectedHash) {
    throw new OAuthError(403, "Session binding mismatch");
  }

  // Retrieve and delete state from KV
  const stored = await kv.get(`oauth_state:${stateToken}`);
  if (!stored) {
    throw new OAuthError(400, "Invalid or expired state");
  }
  await kv.delete(`oauth_state:${stateToken}`);

  const clearCookie = `__Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

  return {
    oauthReqInfo: JSON.parse(stored) as AuthRequest,
    clearCookie,
  };
}

// ── Client Approval (cookie-based) ──

export async function isClientApproved(
  request: Request,
  clientId: string,
  secret: string,
): Promise<boolean> {
  const approved = await getApprovedClientsFromCookie(request, secret);
  return approved.includes(clientId);
}

export async function addApprovedClient(
  request: Request,
  clientId: string,
  secret: string,
): Promise<string> {
  const approved = await getApprovedClientsFromCookie(request, secret);
  if (!approved.includes(clientId)) {
    approved.push(clientId);
  }
  const data = JSON.stringify(approved);
  const signature = await signData(data, secret);
  const value = `${data}|${signature}`;
  return `__Host-approved=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`;
}

async function getApprovedClientsFromCookie(
  request: Request,
  secret: string,
): Promise<string[]> {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const raw = cookies["__Host-approved"];
  if (!raw) return [];

  const decoded = decodeURIComponent(raw);
  const pipeIdx = decoded.lastIndexOf("|");
  if (pipeIdx === -1) return [];

  const data = decoded.slice(0, pipeIdx);
  const signature = decoded.slice(pipeIdx + 1);

  if (!(await verifySignature(data, signature, secret))) return [];

  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// ── Approval Dialog ──

export function renderApprovalDialog(
  request: Request,
  options: {
    client: { clientName?: string; clientId?: string } | null;
    csrfToken: string;
    server: { name: string; description: string; logo?: string };
    setCookie: string;
    state: { oauthReqInfo: AuthRequest };
  },
): Response {
  const clientName = options.client?.clientName || options.client?.clientId || "Unknown Client";
  const encodedState = btoa(JSON.stringify(options.state));

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CookForYou - 認証</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 12px; padding: 2rem; max-width: 400px; width: 90%; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
    .logo { width: 64px; height: 64px; border-radius: 12px; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; margin: 0.5rem 0; }
    p { color: #666; font-size: 0.9rem; }
    .client { font-weight: 600; color: #333; }
    button { background: #06C755; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 1rem; cursor: pointer; margin-top: 1rem; width: 100%; }
    button:hover { background: #05a847; }
  </style>
</head>
<body>
  <div class="card">
    ${options.server.logo ? `<img src="${sanitizeUrl(options.server.logo)}" class="logo" alt="logo">` : ""}
    <h1>${sanitizeText(options.server.name)}</h1>
    <p>${sanitizeText(options.server.description)}</p>
    <p><span class="client">${sanitizeText(clientName)}</span> があなたのレシピデータへのアクセスを要求しています。</p>
    <form method="POST" action="/authorize">
      <input type="hidden" name="csrf_token" value="${options.csrfToken}">
      <input type="hidden" name="state" value="${encodedState}">
      <button type="submit">LINEでログインして許可</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": options.setCookie,
    },
  });
}

// ── Helpers ──

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...vals] = pair.trim().split("=");
    if (key) cookies[key.trim()] = vals.join("=").trim();
  }
  return cookies;
}

async function sha256(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await signData(data, secret);
  return expected === signature;
}

function sanitizeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
  } catch {
    // invalid URL
  }
  return "";
}
