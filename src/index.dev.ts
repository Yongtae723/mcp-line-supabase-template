/**
 * Development entry point — bypasses OAuth for tool testing.
 *
 * Usage:
 *   1. Set DEV_LINE_USER_ID in .dev.vars
 *   2. npm run dev:noauth
 *   3. npx @modelcontextprotocol/inspector --url http://localhost:8788/mcp
 *
 * This connects to Supabase with your LINE user's credentials,
 * so all tools can be tested without LINE Login.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { signInWithLineId } from "./supabase-client";
import { registerHello } from "./tools/hello";

interface DevEnv extends Env {
  DEV_LINE_USER_ID: string;
}

type DevProps = {
  lineUserId: string;
  supabaseUserId: string;
  displayName: string;
};

export class MyMCPDev extends McpAgent<DevEnv, Record<string, never>, DevProps> {
  server = new McpServer({
    name: "My MCP Server (Dev)",
    version: "1.0.0",
  });

  async init() {
    const result = await signInWithLineId(
      this.env.SUPABASE_URL,
      this.env.SUPABASE_ANON_KEY,
      this.env.DEV_LINE_USER_ID,
      this.env.COMMON_PASSWORD_PREFIX,
    );

    if (!result) {
      console.error("Dev auth failed — check DEV_LINE_USER_ID and COMMON_PASSWORD_PREFIX in .dev.vars");
      this.server.tool("error", "Auth failed", {}, async () => ({
        content: [{ type: "text", text: "Auth failed: check DEV_LINE_USER_ID in .dev.vars" }],
      }));
      return;
    }

    const lineUserId = this.env.DEV_LINE_USER_ID;
    const supabaseUserId = result.supabaseUserId;

    const getClient = () =>
      import("./supabase-client").then((m) =>
        m.createAuthenticatedClient(
          this.env.SUPABASE_URL,
          this.env.SUPABASE_ANON_KEY,
          lineUserId,
          this.env.COMMON_PASSWORD_PREFIX,
        ),
      );

    const getUserId = () => supabaseUserId;

    // Register your tools here (same as index.ts)
    registerHello(this.server, getClient, getUserId);
  }
}

export default {
  fetch(request: Request, env: DevEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return (MyMCPDev.serve("/mcp") as any).fetch(request, env, ctx);
    }

    return new Response(
      `MCP Dev Server\n\nConnect MCP Inspector to: ${url.origin}/mcp`,
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};
