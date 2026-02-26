/**
 * LINE Login OAuth flow handler (Hono router).
 *
 * Routes:
 *   GET  /authorize  — Show approval dialog or redirect to LINE Login
 *   POST /authorize  — Handle approval confirmation, redirect to LINE Login
 *   GET  /callback   — Exchange code, get profile, sign in to Supabase, issue MCP token
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { fetchLineProfile, fetchLineToken, getLineAuthorizeUrl, type Props } from "./utils";
import { signInWithLineId } from "./supabase-client";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

/** Ensure callback URL uses https when behind a reverse proxy (e.g. cloudflared) */
function getCallbackUrl(request: Request): string {
  const url = new URL("/callback", request.url);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    url.protocol = "https:";
  }
  return url.href;
}

function redirectToLine(
  request: Request,
  stateToken: string,
  channelId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: getLineAuthorizeUrl({
        channelId,
        redirectUri: getCallbackUrl(request),
        state: stateToken,
      }),
    },
  });
}

// ── GET /authorize — Show approval dialog or redirect to LINE Login ──

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  // If client is already approved, skip dialog and go straight to LINE
  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
    return redirectToLine(c.req.raw, stateToken, c.env.LINE_CHANNEL_ID, { "Set-Cookie": sessionBindingCookie });
  }

  // Show approval dialog
  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      name: "My MCP Server",              // ← Change this
      description: "Your service description here",  // ← Change this
      logo: undefined,                     // ← Optional: URL to your logo
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

// ── POST /authorize — Confirm approval, redirect to LINE Login ──

app.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }

    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );

    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return redirectToLine(c.req.raw, stateToken, c.env.LINE_CHANNEL_ID, Object.fromEntries(headers));
  } catch (error: unknown) {
    console.error("POST /authorize error:", error);
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text(`Internal server error: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
});

// ── GET /callback — LINE token exchange → Profile → Supabase login → MCP token ──

app.get("/callback", async (c) => {
  // 1. Validate OAuth state
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: unknown) {
    if (error instanceof OAuthError) {
      return error.toResponse();
    }
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request data", 400);
  }

  // 2. Exchange LINE authorization code for access token
  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing authorization code", 400);
  }

  const [lineAccessToken, errResponse] = await fetchLineToken({
    code,
    channelId: c.env.LINE_CHANNEL_ID,
    channelSecret: c.env.LINE_CHANNEL_SECRET,
    redirectUri: getCallbackUrl(c.req.raw),
  });
  if (errResponse) return errResponse;

  // 3. Fetch LINE user profile
  const profile = await fetchLineProfile(lineAccessToken);
  if (!profile) {
    return c.text("Failed to fetch LINE profile", 500);
  }

  // 4. Sign in to Supabase using LINE user ID
  const supabaseResult = await signInWithLineId(
    c.env.SUPABASE_URL,
    c.env.SUPABASE_ANON_KEY,
    profile.userId,
    c.env.COMMON_PASSWORD_PREFIX,
  );

  if (!supabaseResult) {
    return new Response(
      "Account not found. Please register via the app first.",
      { status: 403 },
    );
  }

  // 5. Issue MCP token with user context in props
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: profile.userId,
    metadata: {
      label: profile.displayName,
    },
    scope: oauthReqInfo.scope,
    props: {
      lineUserId: profile.userId,
      supabaseUserId: supabaseResult.supabaseUserId,
      displayName: profile.displayName,
    } as Props,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set("Set-Cookie", clearSessionCookie);
  }

  return new Response(null, { status: 302, headers });
});

export { app as LineHandler };
