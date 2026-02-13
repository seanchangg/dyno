/**
 * Authenticated fetch wrapper for frontend API calls.
 *
 * Automatically injects the Supabase JWT from the current session
 * into the Authorization header. Use this instead of bare fetch()
 * for all /api/* calls.
 */

import { supabase } from "@/lib/supabase/client";

/**
 * Fetch with automatic Supabase JWT injection.
 * Falls back to a regular fetch if no session is available.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  return fetch(url, { ...options, headers });
}
