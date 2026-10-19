import { createBrowserClient } from "@supabase/ssr";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-not-set";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Singleton browser client (session lives in httpOnly cookies via @supabase/ssr). */
export function createClient() {
  if (client === null) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
