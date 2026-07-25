/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Dev-only auth bypass (see src/auth/devBypass.ts). Never used in prod builds.
  readonly VITE_DEV_AUTH_BYPASS?: string;
  readonly VITE_DEV_ADMIN_EMAIL?: string;
  readonly VITE_DEV_ADMIN_PASSWORD?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
