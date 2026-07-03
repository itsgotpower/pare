import type { MetadataRoute } from "next";

// Web App Manifest — makes pare installable (Add to Home Screen) on iOS and
// Android. Served at /manifest.webmanifest; the middleware matcher excludes it
// so the browser can fetch it signed-out. Icons come from
// scripts/generate-pwa-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "pare",
    short_name: "pare",
    description: "The fastest way to have more money is to keep more.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Android/Chrome only (Safari never implemented Web Share Target): lets
    // users share a statement PDF from their bank app straight into pare. The
    // service worker intercepts this POST, stashes the files, and redirects to
    // /upload?share-target=1 where the page uploads them through the normal
    // client flow (so auth, results UI, and error handling stay in one place).
    share_target: {
      action: "/upload",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: "statements",
            accept: ["application/pdf", ".pdf", ".ofx", ".qfx"],
          },
        ],
      },
    },
  };
}
