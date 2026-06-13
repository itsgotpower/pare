# Deploying Parse to Cloudflare Workers

This is **Phase 0** scaffolding from the hosted-product plan: getting the current
single-user app building and deployable to Cloudflare Workers via
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) — Cloudflare's
preferred path for Next.js. Later phases wire real auth (D1), per-user data
(Durable Objects), the parser container, R2, and Queues.

## What's wired

- `@opennextjs/cloudflare` + `wrangler` as devDependencies.
- `open-next.config.ts` — minimal config (`defineCloudflareConfig()` with
  defaults; in-memory incremental cache, no R2 bucket needed yet).
- `wrangler.toml` — Worker name, OpenNext entrypoint (`.open-next/worker.js`),
  static assets binding, the self-reference service binding OpenNext needs, plus
  **two bindings, LIVE as of Phase 2**:
  - `DB` — a D1 database (`parse-auth`) for the multi-user account system
    (Phase 2, better-auth). `database_id` is a placeholder until you create it.
  - `USER_DATA` — a Durable Object (`UserDataObject`) for per-user data
    (Phase 2, one DO per user). Implemented in `worker.ts` →
    `lib/repo/user-data-object.ts`.
- `PARSE_DEPLOY_TARGET = "hosted"` in `[vars]` — selects hosted mode at runtime
  (per-user DOs + better-auth; retires the single-user proxy gate).
- `next.config.ts` calls `initOpenNextCloudflareForDev()` so the bindings are
  reachable via `getCloudflareContext()` during `next dev` (no-op in production).
- npm scripts: `cf:build`, `cf:preview`, `cf:deploy`, `cf:typegen`.

## Build & deploy commands

```bash
# 1. Local Next build (type-check + build) — unchanged from before
npx next build

# 2. OpenNext build → produces .open-next/worker.js + .open-next/assets
npm run cf:build          # == opennextjs-cloudflare build

# 3. Local preview in workerd (Cloudflare runtime) — needs no CF account
npm run cf:preview        # builds, then runs the worker locally

# 4. Generate the typed env interface for bindings (optional, dev convenience)
npm run cf:typegen        # writes cloudflare-env.d.ts (gitignored)

# 5. Deploy to your Cloudflare account
npm run cf:deploy         # == opennextjs-cloudflare build && ... deploy
```

`cf:deploy` requires Cloudflare credentials. Authenticate first with either:

```bash
npx wrangler login                      # interactive OAuth, or
export CLOUDFLARE_API_TOKEN=...         # CI / non-interactive
```

The app serves on `https://parse.<your-subdomain>.workers.dev` after deploy.

### Before the first real deploy

```bash
# 1. Create the D1 auth DB; paste the returned database_id into wrangler.toml.
npx wrangler d1 create parse-auth

# 2. Apply the better-auth schema to that D1 DB (d1/migrations/0001_better_auth.sql).
#    Without this, every getSession() throws "no such table: user".
npx wrangler d1 migrations apply parse-auth --remote

# 3. Provision the auth secrets (NOT stored in wrangler.toml).
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL      # e.g. https://parse.<sub>.workers.dev
npx wrangler secret put RESEND_API_KEY       # password-reset email
npx wrangler secret put AUTH_EMAIL_FROM      # From: address
```

`BETTER_AUTH_SECRET` is mandatory — hosted auth (`lib/auth/hosted.ts`) **throws on
startup** if it's unset rather than fall back to better-auth's public default
secret (which would make every session/bearer token forgeable). The `USER_DATA`
Durable Object (`UserDataObject`) is exported from `worker.ts`, so the
`[[durable_objects.bindings]]` / `[[migrations]]` blocks deploy as-is.

> **Still required before hosted mode actually serves data:** `UserDataObject`
> loads the native `better-sqlite3` module, which **does not run on workerd**
> (Phase 3 swaps in a WASM SQLite behind the same `DoBackend` seam). Until then,
> the build/deploy succeeds and auth works, but per-user data requests fail at
> runtime. Tracked as Phase 3.

## Resolved: Node-runtime `proxy.ts` (the auth gate)

Phase 0 hit `ERROR Node.js middleware is not currently supported` because Next
16's `proxy.ts` (the renamed middleware) ran on the **Node runtime** (the
single-user gate uses `node:crypto` HMAC + `node:fs` for the `auth-secret` file)
and `@opennextjs/cloudflare` only supports Edge-runtime middleware.

**Phase 2 resolves this** as planned: in hosted mode (`PARSE_DEPLOY_TARGET=hosted`)
`proxy.ts` short-circuits to `NextResponse.next()` — auth is now per-request via
better-auth and the API routes self-gate (401), so there is no Node middleware to
bundle. The self-hosted gate is unchanged and only runs in self-host mode (which
doesn't deploy to Workers).

## Demo DB note

`better-sqlite3` (the local/self-host `SqliteRepo` backend) is a native module
and does **not** run on Workers. Hosted mode reaches the data layer through the
async `Repo` seam (`lib/repo/`) — Phase 1 adds the Durable Object–backed
`DoRepo`, selected at deploy time. Phase 0 only proves the app *builds and
bundles* for Workers; serving live data from a DO is Phase 1+.
