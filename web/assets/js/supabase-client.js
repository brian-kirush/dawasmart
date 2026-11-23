import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

let clientPromise;

export function getSupabaseClient() {
  if (!SUPABASE_URL.trim() || !SUPABASE_PUBLISHABLE_KEY.trim()) {
    throw new Error(
      "Supabase is not configured. Set the project URL and publishable key in supabase-config.js.",
    );
  }

  if (!clientPromise) {
    clientPromise = import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    ).then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      }),
    );
  }

  return clientPromise;
}
