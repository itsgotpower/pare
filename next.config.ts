import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Read package.json by absolute path, not `import "./package.json"`: the E2E
// harness launches the server from a scratch cwd (`next dev <repo>` — see
// playwright.config.ts), and Next's config transpile resolves relative imports
// against the LAUNCH cwd, not this file's directory.
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
) as { version: string };

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
  // Baseline security headers on every response. A financial-PII app must not be
  // framable (clickjacking the /profile DANGER ZONE wipe / SimpleFIN disconnect),
  // and gets HSTS + nosniff + a conservative referrer policy for free. We set
  // ONLY `frame-ancestors` in the CSP (not script-src) so Next's inline bootstrap
  // isn't broken — a full script-src policy needs per-request nonces and is a
  // separate, larger change. HSTS is inert over http (self-host localhost) and
  // only engages once the app is served over TLS, so it's safe to send globally.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
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
// Also skipped for E2E servers: they exercise the self-host Node path only, and
// a second wrangler dev proxy would race the developer's own `npm run dev`.
if (process.env.NODE_ENV === "development" && !process.env.PARE_E2E) {
  void initOpenNextCloudflareForDev();
}
