import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Make Cloudflare bindings (D1, Durable Objects, etc. declared in wrangler.toml)
// available via getCloudflareContext() during `next dev`. Gate to development only:
// during `next build` (NODE_ENV=production) this wires a wrangler dev-proxy that, now
// that wrangler.toml declares [[containers]], asserts a build ID we don't have at
// build time ("Build ID should be set if containers are defined"). The dev proxy is
// only needed for `next dev`, so skip it during the production build.
// See https://opennext.js.org/cloudflare/get-started
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev();
}
