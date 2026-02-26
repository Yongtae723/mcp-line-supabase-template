/**
 * MCP Server — Entry point.
 *
 * Exports:
 *   - MyMCP: McpAgent Durable Object with your tools
 *   - default: OAuthProvider with LINE Login flow
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { createAuthenticatedClient } from "./supabase-client";
import { registerHello } from "./tools/hello";
import { LineHandler } from "./line-handler";
import type { Props } from "./utils";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "My MCP Server",    // ← Change this
    version: "1.0.0",
  });

  async init() {
    const getClient = () =>
      createAuthenticatedClient(
        this.env.SUPABASE_URL,
        this.env.SUPABASE_ANON_KEY,
        this.props.lineUserId,
        this.env.COMMON_PASSWORD_PREFIX,
      );

    const getUserId = () => this.props.supabaseUserId;

    // Register your tools here
    registerHello(this.server, getClient, getUserId);
  }
}

export default new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp"),
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  defaultHandler: LineHandler as any,
});
