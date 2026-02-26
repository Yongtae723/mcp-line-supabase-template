/**
 * LINE OAuth helpers and Props type for the MCP server.
 */

// Context stored in the MCP auth token and available as this.props in McpAgent.
// Customize this type to include any user context your tools need.
export type Props = {
  lineUserId: string;
  supabaseUserId: string;
  displayName: string;
};

/**
 * Constructs a LINE Login authorization URL.
 */
export function getLineAuthorizeUrl({
  channelId,
  redirectUri,
  state,
}: {
  channelId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", channelId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "profile openid");
  return url.href;
}

/**
 * Exchanges a LINE authorization code for an access token.
 */
export async function fetchLineToken({
  code,
  channelId,
  channelSecret,
  redirectUri,
}: {
  code: string;
  channelId: string;
  channelSecret: string;
  redirectUri: string;
}): Promise<[string, null] | [null, Response]> {
  const resp = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("LINE token exchange failed:", text);
    return [null, new Response("Failed to exchange LINE authorization code", { status: 500 })];
  }

  const body = (await resp.json()) as { access_token?: string };
  if (!body.access_token) {
    return [null, new Response("Missing access token from LINE", { status: 500 })];
  }

  return [body.access_token, null];
}

/**
 * Fetches the LINE user profile using an access token.
 */
export async function fetchLineProfile(accessToken: string): Promise<{
  userId: string;
  displayName: string;
  pictureUrl?: string;
} | null> {
  const resp = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    console.error("LINE profile fetch failed:", await resp.text());
    return null;
  }

  return resp.json() as Promise<{
    userId: string;
    displayName: string;
    pictureUrl?: string;
  }>;
}
