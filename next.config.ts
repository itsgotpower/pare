import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Surface the package.json version to the client bundle (single source of
  // truth — keep the displayed version in sync with the git tag / release).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
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
