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

The app serves on `https://pare.money` (custom domain, dashboard-attached) and
`https://pare.<your-subdomain>.workers.dev` after deploy.

### Before the first real deploy — full hosted provisioning (Phase 3 / P6)

Run these once to stand up the Phase 3 data plane. Resources that mint an **id**
(D1, KV) require you to paste that id back into `wrangler.toml`; R2 and the Queue
bind by **name**, so there's nothing to paste — just keep the names in sync.

```bash
# 1. Auth database (D1) — accounts/sessions.
#    ⚠️ PASTE the returned database_id into wrangler.toml [[d1_databases]].database_id.
npx wrangler d1 create pare-auth

# 2. Apply the better-auth schema to that D1 DB (all d1/migrations/*.sql:
#    0001 core accounts/sessions, 0002 the passkey table). Applies every
#    pending file — re-run after adding migrations. Without 0001 every
#    getSession() throws "no such table: user"; without 0002 passkey
#    sign-in/registration throws "no such table: passkey".
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
npx wrangler secret put BETTER_AUTH_URL      # e.g. https://pare.<sub>.workers.dev
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

## Phase 4 — production hardening (custom domain, rate limits, Turnstile, error tracking)

Phase 4 layers on the hosted hardening. **Everything below is fail-open / inert
until provisioned**, so an un-provisioned deploy behaves exactly like Phase 3.

### New secrets / vars (none committed)

```bash
# Turnstile (bot protection on the waitlist + auth endpoints). When the SECRET is
# set, those endpoints require a valid token; when unset, the check is skipped.
# The SITE key is PUBLIC and is a BUILD-TIME var (baked into the client bundle),
# so it goes in the build environment, NOT `wrangler secret`.
export NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAA...      # public site key (build env)
npx wrangler secret put TURNSTILE_SECRET_KEY          # server secret

# Error tracking (Sentry). When unset, Sentry is a no-op (nothing is sent).
npx wrangler secret put SENTRY_DSN
```

> Create the Turnstile widget (→ site key + secret key) under **Cloudflare
> dashboard → Turnstile**. Create the Sentry project (→ DSN) at sentry.io; pick the
> **Cloudflare Workers** platform.

### Rate limiting — nothing to provision

The per-IP limiters (`RL_AUTH`, `RL_WAITLIST`) are `[[unsafe.bindings]]` of type
`ratelimit` in `wrangler.toml` — they deploy with the Worker, no resource to
create and no id to paste. Counting is per-colo + best-effort (abuse mitigation,
not a billing-grade counter). They fail OPEN when absent (dev/self-host), so they
never break local work.

### Custom domain

**DONE** — the apex `pare.money` is live on the `pare` Worker, attached via the
**dashboard** (Workers & Pages → pare → Domains → Add Domain; DNS record + edge
cert were provisioned automatically), not via a `[[routes]]` block. Dashboard-
added custom domains survive deploys, so the config deliberately carries no
routes. `BETTER_AUTH_URL` is set to `https://pare.money`.

If the origin ever changes (or another host is added), three things move
together — auth breaks in confusing ways if any one is skipped:

1. `npx wrangler secret put BETTER_AUTH_URL` → the new origin (better-auth
   issues cookies/email links and derives the passkey rpID from it).
2. Google OAuth: add `<new origin>/api/auth/callback/google` to the client's
   authorized redirect URIs in the Google Cloud console (exact string match;
   keep the old URI during cutover — extra entries are harmless).
3. Redeploy.

### Account deletion

No provisioning. The hosted **Delete account** flow (`DELETE /api/account`, surfaced
in the profile Danger zone) hard-deletes across all four stores — the user's
Durable Object database (drop all tables), their R2 PDFs, their KV job records, and
their better-auth identity rows in D1 — and logs a PII-free audit line
(`event: "account_deletion"` with a hashed userId). It's idempotent, so a retry
after a partial failure is safe.

### Privacy policy

Served at `/privacy` (public, static) and linked from the landing-page footer. The
contact address is `privacy@pare.money` — set up email forwarding for that alias
when the domain is live.

## Phase 6 — billing (Stripe subscriptions)

The commercial billing layer lives in `cloud/billing/` (proprietary) with thin
shims under `app/api/billing/`. Like everything above it is **inert until
provisioned** — no Stripe secret ⇒ the routes 503 and `PARE_CLOUD` unset ⇒ no plan
limits — so an un-provisioned deploy is unchanged. Full reference:
[`cloud/billing/README.md`](cloud/billing/README.md).

### New secrets / vars (none committed)

```bash
# Stripe API + webhook signing secrets. When STRIPE_SECRET_KEY is unset the
# billing routes return 503 (nothing Stripe runs).
npx wrangler secret put STRIPE_SECRET_KEY            # sk_live_… / sk_test_…
npx wrangler secret put STRIPE_WEBHOOK_SECRET        # whsec_… (the endpoint signing secret)

# The Pro price id is NOT secret — add it to [vars] in wrangler.toml:
#   [vars]
#   STRIPE_PRICE_PRO = "price_…"
#   PARE_CLOUD = "1"          # turns ON plan-limit enforcement + metering
```

### D1 migrations

The subscription + usage tables go in the **auth** D1 DB (`pare-auth`):

```bash
npx wrangler d1 migrations apply pare-auth    # applies 0003_subscription + 0004_billing_usage
```

### Stripe dashboard

1. Create a **Product → Price** (recurring) for Pro; copy the `price_…` id into
   `STRIPE_PRICE_PRO`.
2. Create a **Webhook endpoint** → `https://<host>/api/billing/webhook`, subscribe
   to `checkout.session.completed` and `customer.subscription.created|updated|
   deleted`; copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Enable the **Billing Portal** (Settings → Billing → Customer portal) so
   `/api/billing/portal` works.

> The webhook needs no auth wiring: in hosted mode the Edge gate is retired
> (`middleware.ts`), and the handler authenticates by Stripe signature
> (WebCrypto, async — `constructEventAsync`).

### Local testing

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook   # prints whsec_… to use
stripe trigger checkout.session.completed
```

### Still TODO before launch

- `/profile` UI: an **Upgrade** button (POST `/api/billing/checkout` → redirect to
  `url`) and a **Manage billing** link (POST `/api/billing/portal`).
- Lock the free cap + Pro price (currently placeholders — PRD §6 / FR-72).
- iOS (Expo): Apple generally requires IAP for in-app digital subscriptions;
  Stripe Checkout covers web/Android.

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
