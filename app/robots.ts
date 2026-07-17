import type { MetadataRoute } from "next";

// Everything not listed is the public marketing surface (see app/sitemap.ts).
// The disallowed paths are login-gated anyway — a crawler only sees a redirect
// — but listing them saves crawl budget and keeps /login?from=… noise out of
// search results.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/login",
        "/dashboard",
        "/transactions",
        "/upload",
        "/categories",
        "/goals",
        "/recurring",
        "/merchants",
        "/profile",
        "/connect",
        "/oauth",
        "/offline",
      ],
    },
    sitemap: "https://pare.money/sitemap.xml",
  };
}
