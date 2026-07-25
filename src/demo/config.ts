// Local demo mode: fully offline UI review. No Supabase, auth, email, or Cloudflare.
// Gated on import.meta.env.DEV so it is impossible to enable in a production build:
// in `vite build` this folds to false and every demo branch is dead-code eliminated.
export const DEMO_MODE =
  import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "true";
