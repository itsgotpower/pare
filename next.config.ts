import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Make Cloudflare bindings (D1, Durable Objects, etc. declared in wrangler.toml)
// available via getCloudflareContext() during `next dev`. No-op for the production
// Worker build. Kept at the bottom so the exported config is unaffected.
// See https://opennext.js.org/cloudflare/get-started
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
