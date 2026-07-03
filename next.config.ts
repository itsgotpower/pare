import type { NextConfig } from "next";
import pkg from "./package.json";

// A unique id per production build. Prefer the CI commit SHA (Cloudflare
// Workers/Pages or GitHub Actions); fall back to version + build timestamp so
// every local/self-host build is still unique. It cache-busts the service
// worker: RegisterSW appends it to the SW url (`/sw.js?v=<id>`), so a new deploy
// forces the SW to update and evict the previous build's cached chunks — the
// fix for the installed-PWA "failed to load chunk" error after a deploy.
const BUILD_ID =
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.WORKERS_CI_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  `${pkg.version}-${Date.now()}`;

const nextConfig: NextConfig = {
  // Surface the package.json version to the client bundle (single source of
  // truth — keep the displayed version in sync with the git tag / release).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
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
