# Deploying Pare to Cloudflare Workers

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
  - `DB` — a D1 database (`pare-auth`) for the multi-user account system
    (Phase 2, better-auth). `database_id` is a placeholder until you create it.
  - `USER_DATA` — a Durable Object (`UserDataObject`) for per-user data
    (Phase 2, one DO per user). Implemented in `worker.ts` →
    `lib/repo/user-data-object.ts`.
  - **Phase 3 data plane (all LIVE as of P6):** `PARSER`/`ParserContainer`
    (Cloudflare Container running the Python parser), `PDF_BUCKET` (R2 — uploaded
    PDF bytes, `lib/storage/pdf-store.ts`), `PARSE_QUEUE` (Queue producer +
    consumer — the async parse pipeline, `lib/queue/`), and `PARSE_JOBS` (KV —
    job-status records). See the provisioning sequence below.
- `PARE_DEPLOY_TARGET = "hosted"` in `[vars]` — selects hosted mode at runtime
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

### Before the first real deploy — full hosted provisioning (Phase 3 / P6)

Run these once to stand up the Phase 3 data plane. Resources that mint an **id**
(D1, KV) require you to paste that id back into `wrangler.toml`; R2 and the Queue
bind by **name**, so there's nothing to paste — just keep the names in sync.

```bash
# 1. Auth database (D1) — accounts/sessions.
#    ⚠️ PASTE the returned database_id into wrangler.toml [[d1_databases]].database_id.
npx wrangler d1 create pare-auth

# 2. Apply the better-auth schema to that D1 DB (d1/migrations/0001_better_auth.sql).
#    Without this, every getSession() throws "no such table: user".
npx wrangler d1 migrations apply pare-auth --remote

# 3. Uploaded-PDF object storage (R2). Binds by bucket_name in wrangler.toml
#    ([[r2_buckets]] binding = "PDF_BUCKET", bucket_name = "pare-pdfs") — NO id
#    to paste; just keep the name identical.
npx wrangler r2 bucket create pare-pdfs

# 4. Async parse pipeline — the Queue. Binds by queue name ("parse-jobs") for both
#    the producer ([[queues.producers]]) and consumer ([[queues.consumers]]) — NO
#    id to paste.
npx wrangler queues create parse-jobs

# 5. Parse-job status records (KV).
#    ⚠️ PASTE the returned id into wrangler.toml [[kv_namespaces]].id (binding = "PARSE_JOBS").
npx wrangler kv namespace create PARSE_JOBS

# 6. Provision the auth secrets (NOT stored in wrangler.toml).
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put BETTER_AUTH_URL      # e.g. https://parse.<sub>.workers.dev
npx wrangler secret put RESEND_API_KEY       # password-reset email
npx wrangler secret put AUTH_EMAIL_FROM      # From: address

# 7. Deploy. The Durable Objects (USER_DATA, ParserContainer) and the parser
#    CONTAINER IMAGE (lib/parser/Dockerfile) are built + pushed automatically by
#    this one command — `wrangler deploy` reads [[containers]] in wrangler.toml,
#    builds the image (needs a working local Docker daemon), and registers it
#    alongside the Worker. There is no separate "deploy the container" step.
npm run cf:deploy
```

**Which resources need real ids pasted into `wrangler.toml`:**

| Resource | Binding | Provisioned by | Paste back? |
|----------|---------|----------------|-------------|
| D1 auth DB | `DB` | `wrangler d1 create pare-auth` | **YES** — `database_id` |
| KV job store | `PARSE_JOBS` | `wrangler kv namespace create PARSE_JOBS` | **YES** — `id` |
| R2 PDF bucket | `PDF_BUCKET` | `wrangler r2 bucket create pare-pdfs` | No — binds by `bucket_name` |
| Queue | `PARSE_QUEUE` (+ consumer) | `wrangler queues create parse-jobs` | No — binds by `queue` name |
| USER_DATA DO | `USER_DATA` | created on deploy (`[[migrations]]`) | No |
| ParserContainer | `PARSER` | built + pushed on deploy (`[[containers]]`) | No |

Until the placeholder ids (`database_id`/KV `id` = all-zeros in the committed
`wrangler.toml`) are replaced, those bindings resolve to non-existent resources
and the corresponding requests fail at runtime.

`BETTER_AUTH_SECRET` is mandatory — hosted auth (`lib/auth/hosted.ts`) **throws on
startup** if it's unset rather than fall back to better-auth's public default
secret (which would make every session/bearer token forgeable). The `USER_DATA`
Durable Object (`UserDataObject`) is exported from `worker.ts`, so the
`[[durable_objects.bindings]]` / `[[migrations]]` blocks deploy as-is.

> **Resolved in Phase 3:** `UserDataObject` no longer loads native
> `better-sqlite3` (which can't run on workerd). It now runs `SqliteRepo` over a
> `DoSqlBackend` against the DO's **native** SQLite (`ctx.storage.sql`), proven
> against a real DO in `lib/repo/do-sql-backend.workers-spec.ts` and end-to-end
> through the upload pipeline in `lib/queue/e2e.workers-spec.ts`. Per-user data
> requests now serve live in hosted mode.

## Resolved: Node-runtime `proxy.ts` (the auth gate)

Phase 0 hit `ERROR Node.js middleware is not currently supported` because Next
16's `proxy.ts` (the renamed middleware) ran on the **Node runtime** (the
single-user gate uses `node:crypto` HMAC + `node:fs` for the `auth-secret` file)
and `@opennextjs/cloudflare` only supports Edge-runtime middleware.

**Phase 2 resolves this** as planned: in hosted mode (`PARE_DEPLOY_TARGET=hosted`)
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
