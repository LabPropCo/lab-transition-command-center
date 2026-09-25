import { useEffect } from "react";

// Per-route <title>/meta-description for the public marketing pages. This is
// a single-page Vite app with no server-side routing, so document head tags
// are static in index.html by default; this keeps them accurate per screen.
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute("content", description);
  }, [title, description]);
}
