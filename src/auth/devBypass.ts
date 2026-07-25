import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// DEV-ONLY auth bypass.  NOT a production code path.
// Two hard gates, both required:
//   1. import.meta.env.DEV  → true only under `vite dev`; in `vite build` this
//      folds to false and the whole body below is dead-code eliminated.
//   2. VITE_DEV_AUTH_BYPASS === "true"  → explicit opt-in per machine.
// When active it performs a REAL password sign-in as the seeded admin.
// ============================================================================
export const DEV_BYPASS_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

export interface BypassResult { ok: boolean; error?: string }

export async function runDevBypass(supabase: SupabaseClient | null): Promise<BypassResult> {
  // Gate first so everything after (including the default password) is stripped in prod.
  if (!import.meta.env.DEV) return { ok: false };
  if (import.meta.env.VITE_DEV_AUTH_BYPASS !== "true") return { ok: false };

  if (!supabase) {
    return {
      ok: false,
      error:
        "Auth bypass needs a Supabase connection. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY in .env.local — or use VITE_DEMO_MODE=true for a " +
        "no-backend UI review.",
    };
  }

  const email = import.meta.env.VITE_DEV_ADMIN_EMAIL || "jessica@texascapitalpartners.com";
  // Prefer the password from VITE_DEV_ADMIN_PASSWORD when it is provided; only
  // fall back to the default constant if the env variable is absent/empty.
  const DEV_DEFAULT_PASSWORD = "labdev-transition";
  const envPassword = import.meta.env.VITE_DEV_ADMIN_PASSWORD;
  const password = envPassword && envPassword.length > 0 ? envPassword : DEV_DEFAULT_PASSWORD;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      ok: false,
      error:
        `Dev sign-in failed for ${email}: ${error.message}. ` +
        "Set the dev password once with `npm run set:dev-password`, then restart. " +
        "(If you chose a custom password, add VITE_DEV_ADMIN_PASSWORD to .env.local.)",
    };
  }
  console.warn(
    "%c[DEV MODE] Auto-signed in as " + email + " — local dev only; production auth is unchanged.",
    "color:#A5624A;font-weight:bold",
  );
  return { ok: true };
}
