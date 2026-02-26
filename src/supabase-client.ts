/**
 * Supabase authentication and client creation.
 *
 * Uses signInWithPassword with LINE-derived credentials.
 * This assumes your service creates Supabase users with:
 *   - Email: {lineUserId}@line.com
 *   - Password: {COMMON_PASSWORD_PREFIX}{lineUserId.slice(0, 6)}
 *
 * Adjust the email/password format to match your existing auth logic.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Signs in to Supabase using the LINE user ID and returns the authenticated user ID.
 */
export async function signInWithLineId(
  supabaseUrl: string,
  supabaseAnonKey: string,
  lineUserId: string,
  passwordPrefix: string,
): Promise<{ supabaseUserId: string; client: SupabaseClient } | null> {
  const client = createClient(supabaseUrl, supabaseAnonKey);

  // ⚠️ Customize this to match your service's auth logic
  const email = `${lineUserId}@line.com`;
  const password = `${passwordPrefix}${lineUserId.slice(0, 6)}`;

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("Supabase signIn failed:", error.message);
    return null;
  }

  return {
    supabaseUserId: data.user.id,
    client,
  };
}

/**
 * Creates an authenticated Supabase client for tool calls.
 * Re-authenticates each time for simplicity (v1).
 */
export async function createAuthenticatedClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  lineUserId: string,
  passwordPrefix: string,
): Promise<SupabaseClient | null> {
  const result = await signInWithLineId(supabaseUrl, supabaseAnonKey, lineUserId, passwordPrefix);
  return result?.client ?? null;
}
