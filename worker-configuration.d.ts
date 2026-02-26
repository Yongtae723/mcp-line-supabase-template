interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  LINE_CHANNEL_ID: string;
  LINE_CHANNEL_SECRET: string;
  COMMON_PASSWORD_PREFIX: string;
  COOKIE_ENCRYPTION_KEY: string;
}
