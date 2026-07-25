import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// M0: static SPA. Cloudflare Pages serves /dist and rewrites all routes to
// index.html (see public/_redirects) so client-side routing works on refresh.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: true },
});
