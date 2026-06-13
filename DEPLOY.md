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
  **two stubbed bindings declared for later phases**:
  - `AUTH_DB` — a D1 database (`parse-auth`) for the multi-user account system
    (Phase 2, better-auth). `database_id` is a placeholder.
  - `USER_DATA` — a Durable Object (`UserDataObject`) for per-user data
    (Phase 1/2, `DoRepo`). **The DO class is not implemented yet.**
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

The stubbed bindings reference resources that don't exist yet. For a clean
deploy you must either create them or comment them out in `wrangler.toml`:

```bash
# Create the D1 auth DB and paste the returned database_id into wrangler.toml
npx wrangler d1 create parse-auth
```

The `USER_DATA` Durable Object will only deploy once a `UserDataObject` class is
exported from the Worker (Phase 1/2). Until then, comment out the
`[[durable_objects.bindings]]` and `[[migrations]]` blocks, or the deploy will
fail validation.

## Known blocker: Node-runtime `proxy.ts` (the auth gate)

> **The OpenNext build currently fails on this app** with:
> `ERROR Node.js middleware is not currently supported.`

Next 16's `proxy.ts` (the renamed middleware) runs on the **Node runtime** here
because the auth gate uses `node:crypto` (HMAC) and `node:fs` (reads the
`auth-secret` file) — see `lib/auth/session.ts`. `@opennextjs/cloudflare`
(v1.19.x) only supports **Edge-runtime** middleware today; Node `proxy.ts`
support is in progress upstream (PRs opennextjs/opennextjs-cloudflare#1280 and
#1275, issue #1277) but **not yet released**.

This is expected and does **not** indicate a config problem — the rest of the
OpenNext pipeline builds cleanly and produces a working `.open-next/worker.js`
(verified locally by building with the proxy temporarily removed). Resolved by
one of (in plan order):

1. **Phase 2 retires the proxy gate in hosted mode** anyway (better-auth on D1
   replaces the single-user scrypt + HMAC-cookie gate). At that point the auth
   check moves out of Node middleware.
2. Upgrade `@opennextjs/cloudflare` once the Node-`proxy.ts` PRs ship.
3. (If neither is ready) port `proxy.ts` to the Edge runtime: swap `node:crypto`
   for Web Crypto (async HMAC) and source the secret from an env var / KV
   instead of the filesystem. Out of scope for Phase 0 (config-only).

## Demo DB note

`better-sqlite3` (the local/self-host `SqliteRepo` backend) is a native module
and does **not** run on Workers. Hosted mode reaches the data layer through the
async `Repo` seam (`lib/repo/`) — Phase 1 adds the Durable Object–backed
`DoRepo`, selected at deploy time. Phase 0 only proves the app *builds and
bundles* for Workers; serving live data from a DO is Phase 1+.
