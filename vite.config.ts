import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// M0: static SPA. Cloudflare Pages serves /dist and rewrites all routes to
// index.html (see public/_redirects) so client-side routing works on refresh.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true },
  // xlsx's legacy .xls (BIFF8/CFB) codec breaks when esbuild pre-bundles it
  // for dev (and when Rollup processes it a second time for the production
  // build) — confirmed by testing the same file against the raw, unbundled
  // ESM module, which parses it correctly. Excluding it from both steps
  // lets the browser load SheetJS's own ESM build directly, unmodified.
  optimizeDeps: { exclude: ["xlsx"] },
});
