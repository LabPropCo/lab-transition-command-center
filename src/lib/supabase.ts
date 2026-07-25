import { createClient } from "@supabase/supabase-js";

// The browser client uses the anon key. It is intentionally powerless on its
// own: Row-Level Security in Postgres is the authorization boundary (M1).
//
// Auth in V1 is invite-only 6-digit email OTP. Sign-in MUST pass
// { shouldCreateUser: false } so the login screen can never create an account —
// users are provisioned only by an admin via a server-side Edge Function.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseReady = Boolean(url && anonKey);

// In M0 the shell renders without a backend; the client is created lazily so a
// missing .env doesn't crash the themed shell.
export const supabase = supabaseReady
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
