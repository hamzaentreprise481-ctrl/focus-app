import "server-only";

import { createClient } from "@supabase/supabase-js";

export function secretAdminConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
  );
}

/**
 * Server-only Supabase admin client. The secret key bypasses RLS and therefore
 * must never be imported by Client Components or exposed through NEXT_PUBLIC_*.
 */
export function createSecretAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
