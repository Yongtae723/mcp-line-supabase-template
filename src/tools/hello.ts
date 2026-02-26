/**
 * Example tool — Replace this with your own tools.
 *
 * This is a simple "hello" tool that returns the authenticated user's profile.
 * It demonstrates how to use the Supabase client and user ID in a tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export function registerHello(
  server: McpServer,
  getClient: () => Promise<SupabaseClient | null>,
  getUserId: () => string,
) {
  server.tool(
    "hello",
    "Returns a greeting with the authenticated user's info. Replace this with your own tools.",
    {},
    async () => {
      const client = await getClient();
      if (!client) {
        return { content: [{ type: "text", text: "Auth error: Failed to sign in to Supabase" }] };
      }

      const userId = getUserId();

      // Example: query your own table here
      // const { data, error } = await client.from("your_table").select("*").eq("user_id", userId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: "Hello from your MCP server!",
                supabase_user_id: userId,
                hint: "Replace this tool with your own in src/tools/",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
