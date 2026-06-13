import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Phase 0 scaffolding (hosted pivot): minimal OpenNext-on-Cloudflare config so the
// CURRENT single-user app builds and deploys to Workers unchanged against the demo DB.
//
// Defaults are intentionally left in place:
//   - incrementalCache: in-memory (no R2 bucket wired yet). Fine for the single-user
//     demo build; swap to the r2-incremental-cache override once an R2 bucket exists.
//   - queue / tagCache: defaults — ISR revalidation is not exercised by this app.
//
// Later phases (see hosted-product-plan.md) layer on the real overrides + bindings.
export default defineCloudflareConfig();
