# Pare — Software Requirements Specification

Companion to [PRD.md](PRD.md). The PRD says *what* and *why*; this SRS enumerates
*what the system must do* (functional requirements, FR-n) and *how well*
(non-functional requirements, NFR-n), plus interfaces, data model, and
constraints. Behavioural ground truth lives in [CLAUDE.md](../CLAUDE.md); this
document is the numbered, testable distillation.

---

## 1. Purpose

Define the requirements for **Pare**, a privacy-first personal finance
application that ingests PDF bank/credit-card statements, categorizes
transactions, and presents spending, cash-flow, net-worth, and budgeting
analytics — in two deploy targets (local self-host and Cloudflare-hosted
multi-user) from one codebase.

## 2. Scope

Pare covers: PDF statement ingestion and parsing; transaction storage and
deduplication; rule-based categorization; a dashboard of spending/income/
cashflow/net-worth analytics; cash-flow forecasting; subscription detection;
budget goals; data export; account/identity management; and a local MCP server.
Hosted mode adds multi-user auth, per-user isolated databases, an async upload
pipeline, account deletion, and production hardening.

Out of scope (see PRD §3 non-goals): aggregator/open-banking connections, moving
money, real-time data, and generic CSV import.

## 3. Definitions

| Term | Meaning |
|---|---|
| **Self-host** | Single-user deploy on the user's machine; Node runtime; `better-sqlite3` file DB at `data/pare.db`. |
| **Hosted** | Multi-user deploy on Cloudflare Workers (`PARE_DEPLOY_TARGET=hosted`). |
| **Repo seam** | Async `Repo` interface (`lib/repo/`) abstracting the data backend so the same `lib/db` SQL runs on both targets. |
| **DO** | Cloudflare Durable Object; in hosted mode, one per user, backed by native DO SQLite (`ctx.storage.sql`). |
| **D1** | Cloudflare's SQLite database service; holds the better-auth identity tables (`pare-auth`). |
| **R2** | Cloudflare object storage; holds uploaded PDFs transiently (per-user prefix). |
| **Queue** | Cloudflare Queues; carries async parse jobs. |
| **KV** | Cloudflare KV; holds parse-job status records. |
| **Container** | Cloudflare Container running the Python parser over HTTP (hosted parsing). |
| **flow** | Transaction direction class: `spend`, `payment`, `income`, `transfer`, `fee_interest`. |
| **account_kind** | Analytics classification: `card`, `chequing`, `savings`, `cash`, `investment`, `unknown`. |
| **dedup_key** | SHA-256 of `source\|txn_date\|description\|amount\|seq`; UNIQUE. |
| **MCP** | Model Context Protocol; the local finance server Claude connects to. |
| **Latest data month** | The most recent month with transaction data (≠ calendar month; statements lag). |

## 4. System overview & architecture

Pare is a Next.js 16 (App Router, TypeScript) application. The query layer
(`lib/db/*.ts`, synchronous SQL) sits behind the async `Repo` seam; the deploy
target selects the backend at runtime.

**Self-host data flow:**

```
Browser ──HTTP──> Next.js (Node) ──> Repo(SqliteRepo) ──> better-sqlite3 file DB (data/pare.db)
                       │
                       └─ /api/upload ──> parse_statements.py (child_process + poppler) ──> insert + recategorize
Claude ──stdio──> MCP server (mcp/) ──> same lib/db ──> data/pare.db
```

**Hosted data flow (Cloudflare Workers via OpenNext):**

```
Browser/Expo ──HTTPS──> Worker (worker.ts)
   │
   ├─ middleware.ts (Edge): HMAC session gate (self-host) / pass-through (hosted)
   ├─ Auth: better-auth on D1 (email/password, passkeys, bearer)
   ├─ Per-user data: route ──> that user's Durable Object (DoSqlBackend over native SQLite)
   └─ Upload: POST /api/upload ──> R2 (u/<userId>/…) ──> Queue(parse-jobs)
                                          │
                          Queue consumer ─┘──> Container parser (HTTP /parse)
                                              ──> write rows to user's DO (batch)
                                              ──> recategorizeAll ──> delete PDF from R2
                                              ──> KV job status: queued|parsing|done|failed
```

**Tenant isolation by construction:** a hosted request resolves to exactly one
user's DO; there is no shared multi-tenant transactions table, so cross-user
leakage via a missing `WHERE user_id = ?` is not a possible failure mode.

---

## 5. Functional requirements

### 5.1 Authentication & identity

- **FR-1 (self-host gate).** Self-host SHALL gate all non-public routes behind a
  single-user session. First run with no `app_user` row SHALL present a "create
  profile" flow (name + password); thereafter a password sign-in. *(PRD §1)*
- **FR-2 (session token).** The session SHALL be a stateless HMAC-SHA256 cookie
  (`pare_session`, 30-day) signed via WebCrypto, verifiable identically on Node
  and the Edge runtime. The signing secret SHALL resolve from
  `PARE_AUTH_SECRET` first, falling back (self-host only) to a generated,
  gitignored `data/auth-secret` file.
- **FR-3 (password storage).** Passwords SHALL be hashed with scrypt
  (`scrypt:N:r:p:salt:hash`); login and change-password failures SHALL sleep
  ~500 ms to blunt timing/brute-force.
- **FR-4 (password change rotates sessions).** Changing the password under a
  file secret SHALL rotate that secret (invalidating all sessions) and re-issue
  the caller's cookie.
- **FR-5 (hosted auth).** Hosted mode SHALL use better-auth on D1 supporting
  email/password, password-reset verification, **passkeys/WebAuthn**, and
  **bearer tokens** (for the future mobile client). `BETTER_AUTH_SECRET` is
  mandatory; hosted auth SHALL throw on startup if it is unset.
- **FR-6 (route gating).** Every route SHALL be gated except the public set:
  `/`, `/login`, `/api/auth`, `/api/waitlist` (and `/privacy` in waitlist mode).
  Page requests redirect to `/login?from=…` (same-app paths only); `/api/*`
  returns 401 JSON. Signed-in visitors to `/` SHALL be redirected to
  `/dashboard`.

### 5.2 Waitlist (pre-launch)

- **FR-7.** The public landing SHALL capture emails via `POST /api/waitlist`,
  persisting to a `waitlist` table with a UNIQUE email (`INSERT OR IGNORE`). A
  repeat email SHALL return `alreadyJoined` **without revealing list
  membership**. *(PRD §5, §7)*
- **FR-8.** `PARE_WAITLIST_ONLY=1` SHALL restrict the hosted app to `/`,
  `/api/waitlist`, and `/privacy`.

### 5.3 PDF upload & parsing

- **FR-10 (upload UI).** `/upload` SHALL accept drag-drop **PDF only**. (The
  CSV-import path was removed; see PRD N5.)
- **FR-11 (parser).** A Python parser (`lib/parser/parse_statements.py`, poppler
  `pdftotext`) SHALL extract transactions and per-file statement metadata.
  `--json` mode SHALL output `{transactions:[…], statements:[…]}`.
- **FR-12 (supported formats).** The parser SHALL support **Amex Gold**, **CIBC
  Aeroplan Visa**, and **CIBC chequing**, routed in order Aeroplan+Visa → CIBC
  Account Statement → Amex (fallback). *(External interfaces §7.1)*
- **FR-13 (balance reconciliation).** Chequing direction SHALL be derived from
  balance reconciliation (`prev ± amount == printed balance`), not column
  offsets; parsed inflow/outflow/closing SHALL tie to the statement summary box.
- **FR-14 (statement metadata).** Each parsed statement SHALL record source,
  account, period, filename, `closing_balance` (as printed), and `closing_date`.
- **FR-15 (self-host ingest).** Self-host SHALL parse inline via `child_process`,
  insert rows, then run `recategorizeAll()`.
- **FR-16 (hosted ingest pipeline).** Hosted upload SHALL: authenticate
  (cookie or bearer), stream the PDF to **R2** under `u/<userId>/…`, enqueue a
  `{userId, r2Key, filename}` job, and return `{jobId}` (HTTP 202). The **queue
  consumer** SHALL fetch from R2 → parse via the Container → write
  statements + transactions + recategorize into the user's DO in one batch → on
  success delete the PDF from R2; on failure leave the PDF for retry and record
  failure. `GET /api/upload/status?jobId` SHALL return
  `queued|parsing|done|failed` + inserted/skipped counts, rejecting jobs not
  owned by the caller.
- **FR-17 (deduplication).** Inserts SHALL be deduplicated by `dedup_key`
  (`INSERT OR IGNORE` on a UNIQUE column); a repeat upload SHALL NOT create
  duplicates.

### 5.4 Categorization

- **FR-20 (rule engine).** Categorization SHALL apply `category_rules` keyword
  matches **first-match-wins**, seeded from gitignored `data/seed-rules.json`
  when present, else the generic `STARTER_RULES`.
- **FR-21 (recategorize-all).** `recategorizeAll()` SHALL re-apply rules to all
  rows, **skipping manual overrides**. Card rows get full rules (fallback
  `Other / uncategorized`); chequing `spend` rows get any rule (fallback
  `Banking`); chequing `transfer` rows get **only user-defined** categories
  (seeded card-merchant rules excluded to prevent false matches);
  income/payment/fee_interest are never reclassified.
- **FR-22 (user rule persistence).** User-added rules SHALL persist to gitignored
  `data/user-rules.json` and be restored on a fresh DB seed, surviving DB wipes.
  Private identifiers (e.g. the rent e-transfer handle) SHALL live only there,
  never in tracked source.
- **FR-23 (manual overrides).** A user SHALL be able to override a single
  transaction's category (`category_overrides`, UNIQUE per transaction);
  `v_transactions` SHALL resolve `effective_category = COALESCE(override,
  category)`.
- **FR-24 (rule CRUD).** `/categories` SHALL support rule create/delete grouped
  by category, override→rule suggestions, and recategorize-on-add.
- **FR-25 (exposed action).** `POST /api/categories {action:"recategorize_all"}`
  and a "RECATEGORIZE ALL" button SHALL trigger FR-21.

### 5.5 Dashboard & transactions

- **FR-30 (dashboard tabs).** `/dashboard` SHALL present OVERVIEW (monthly bar,
  category donut, totals, goals, top merchants), BY CATEGORY, INCOME, BASELINE,
  CASHFLOW, FORECAST, and NET WORTH tabs. `/transactions` SHALL provide a
  searchable/filterable table with spend/all tabs and pagination. Spend charts
  SHALL count only `flow='spend'` from card accounts (via `v_transactions`).
- **FR-31 (income).** The INCOME tab SHALL show income-vs-spend bars,
  income-by-type donut, totals, and per-month net cashflow (income − fixed −
  variable), with income type derived from description.
- **FR-32 (baseline).** The BASELINE tab SHALL compute a discretionary baseline =
  card spend with single charges ≥ a threshold (200/300/500) removed, listing the
  excluded one-offs transparently.
- **FR-33 (net cashflow).** Net SHALL subtract rent (categorized chequing
  transfer) and treat Rent/housing + Phone/utilities + chequing fees as the fixed
  bucket.
- **FR-34 (Sankey).** The CASHFLOW tab SHALL render a money-flow Sankey: income
  types → INCOME hub → top-8 spend categories + EVERYTHING ELSE + SAVED (deficit
  months show a FROM SAVINGS source), with ALL/per-month selection and
  in/out/saved + savings-rate cards.
- **FR-35 (heatmap).** A daily-spend calendar heatmap SHALL show card-spend per
  day (terracotta ramp anchored to all-days p95), month navigation, and a
  spend-by-weekday row.
- **FR-36 (insights).** An always-visible INSIGHTS panel SHALL surface local
  rule-based tips (over/near-budget goals, MoM category moves, surplus/deficit,
  large one-offs, current-calendar-month forecast, top category),
  severity-sorted. All heuristics SHALL use the **latest data month** except the
  forecast insight (current calendar month). *(FR-37)*
- **FR-37 (latest-data-month rule).** Goal progress and insights SHALL key off
  the latest month with spend data, not `new Date()`.
- **FR-38 (budget goals).** `/goals` SHALL support per-category monthly limits
  with progress bars (green <80%, yellow <100%, red ≥100%) and suggested limits
  from a 6-month average.

### 5.6 Forecasting

- **FR-40 (same-month forecast).** A current-calendar-month forecast SHALL
  project income from payroll only (one-off refunds excluded) and fixed+variable
  from the median of the last 3 complete months; it SHALL switch to per-category
  pace mode once the current month has ≥5 days of data.
- **FR-41 (30/60/90-day cash-flow forecast).** The FORECAST tab SHALL project the
  latest chequing `closing_balance` (the reconciled anchor) forward daily over
  90 points, sliced to 30/60/90-day toggles.
- **FR-42 (forecast components).** The projection SHALL model disjoint buckets:
  payroll as discrete deposits (median of last ≤8, cadence = median gap clamped
  7–35d), the fixed bucket as one monthly event on the observed rent day,
  cadence-scheduled subscriptions, and discretionary = median variable minus
  scheduled subs drained daily.
- **FR-43 (uncertainty).** The forecast SHALL show a ±1σ band (σ of monthly
  variable spend over last ≤6 complete months × √(days/30.44)).
- **FR-44 (estimate framing & staleness).** The forecast SHALL be explicitly
  framed as an estimate (not a promise), surface anchor staleness, and show an
  empty state ("re-upload your latest chequing statement") when the anchor is
  NULL. One-off income SHALL be excluded.

### 5.7 Net worth

- **FR-45.** Net worth SHALL be statement-cadence: each statement's
  `closing_balance`/`closing_date`, signed by `getNetWorth()` (cards negative,
  chequing positive).
- **FR-46.** A `manual_entries` table (name, kind asset|liability, amount,
  effective_date, note) SHALL hold non-statement items; re-adding the same name
  with a newer date SHALL update its value and extend history.
- **FR-47.** The series SHALL be monthly points carrying forward the latest
  balance per account/item (point-in-time, not live), rendered as net/assets/
  liabilities trend lines with a balances breakdown and manual-entry CRUD.
  `insertStatement` SHALL UPSERT by filename (re-upload backfills balances).

### 5.8 Subscription / recurring detection

- **FR-50.** `/recurring` SHALL detect merchants charged across **3+ months** by
  stable amount + cadence or known-merchant keyword.
- **FR-51.** It SHALL report monthly/annual totals and frequency.
- **FR-52.** It SHALL flag variable-amount and double-bill cases.

### 5.9 MCP server (self-host)

- **FR-60.** A local stdio MCP server (`npm run mcp`) SHALL expose **16
  read/write tools** over `data/pare.db`, reusing `lib/db`. It SHALL honor
  `PARE_DB_PATH` (absolute) when launched by an MCP client.
- **FR-61.** `/connect` SHALL render copy-paste MCP config for Claude Code and
  Claude Desktop, computing absolute machine paths per request. MCP bypasses HTTP
  auth.

### 5.10 Account & data management

- **FR-80 (hard delete, hosted).** `DELETE /api/account` SHALL idempotently erase
  the caller across all four stores: their DO database (drop all tables/views),
  their R2 PDFs (`u/<userId>/`), their KV job records, and their D1 identity rows
  — logging one PII-free audit line (`event:"account_deletion"`, hashed userId,
  per-step counts). It SHALL be surfaced in the profile Danger Zone (hosted only).
- **FR-81 (delete is owner-scoped).** Deletion SHALL only ever affect the
  authenticated caller's data.
- **FR-82 (self-host data ops).** `/api/data` SHALL export `?format=csv|json|
  backup` and `DELETE {confirm:"WIPE"}` SHALL wipe transactions + statements +
  overrides in one transaction (overrides first — FK), keeping rules/goals/
  app_user. `/profile` SHALL show a DATA HEALTH panel (categorized %, per-source
  coverage, last-statement/last-txn recency).

### 5.11 Migration (planned)

- **FR-70 (Monarch/Mint/YNAB import — planned).** Pare SHALL import transaction
  history from Monarch/Mint/YNAB exports, tagging rows with `account_kind` and an
  `import_id` (provenance) so imported data flows into spend/outflow charts, with
  one-click rollback by import. *Schema groundwork has landed (migration 006:
  `imports` table, `account_kind`, `import_id`); the import route/UI is not yet
  built.* `[TBD: source formats + field mapping]`
- **FR-71 (Expo mobile — planned).** A mobile client SHALL use the same hosted
  API via bearer tokens, with share-sheet PDF ingest hitting the existing
  `POST /api/upload` endpoint (designed for this in FR-16). `[TBD]`
- **FR-72 (billing — planned).** Hosted mode SHALL support a free tier with a
  usage cap and a paid tier. `[TBD: cap dimension, price points, processor]`

---

## 6. Non-functional requirements

### Performance

- **NFR-1.** Hosted uploads SHALL return `202 {jobId}` immediately and parse
  asynchronously (no synchronous wait on the Container).
- **NFR-2.** Forecast/Sankey/heatmap aggregates SHALL be computed in the query
  layer / API and remain interactive on a typical multi-year dataset; spend
  charts read through the indexed `v_transactions` view.
- **NFR-3.** SQLite SHALL run in WAL mode with foreign keys ON (self-host).

### Security

- **NFR-4.** All non-public routes SHALL require authentication (FR-6); API
  routes self-gate where the middleware matcher doesn't cover them.
- **NFR-5.** Session/auth secrets SHALL never be committed; `BETTER_AUTH_SECRET`
  is mandatory in hosted mode and SHALL NOT fall back to a public default.
- **NFR-6.** Auth/waitlist endpoints SHALL be protected by per-IP rate limits
  (`RL_AUTH` 20/60s, `RL_WAITLIST` 10/60s) and Turnstile, both **fail-open** when
  unprovisioned. Passkeys and scrypt+timing-sleep harden credentials.

### Privacy

- **NFR-7 (isolation).** Hosted per-user data SHALL be physically isolated in a
  per-user Durable Object database; no shared multi-tenant table SHALL exist for
  transaction data. *(PRD G2)*
- **NFR-8 (no PII in source).** No real names, account/transit numbers, or
  e-transfer handles SHALL appear in tracked source; tests use synthetic
  fixtures; a pre-publish checklist (SECURITY.md) SHALL gate commits.
- **NFR-9 (self-host no-network).** Self-host SHALL make zero outbound network
  calls and emit no telemetry.
- **NFR-10 (ephemeral PDFs).** Hosted uploaded PDFs SHALL be deleted from R2
  immediately after successful parse; retention SHALL be default-off.
- **NFR-11 (gitignored data).** All runtime data (`data/`, the DB, user rules,
  backups, exports, real PDFs) SHALL be gitignored.
- **NFR-14 (PII-redacted telemetry).** Hosted error tracking (Sentry) SHALL strip
  Authorization/Cookie/captcha headers, bodies, and query strings, and mask
  emails; it SHALL be a no-op unless `SENTRY_DSN` is set.
- **NFR-15 (privacy policy).** A public `/privacy` page SHALL disclose what's
  collected, where it lives (the actual D1/DO/R2/KV bindings), retention,
  deletion, and processor relationships (Cloudflare/Turnstile/Resend).

### Reliability

- **NFR-12.** The hosted parse pipeline SHALL retry failed jobs and SHALL NOT
  delete a PDF until its parse succeeds; job status SHALL be observable.
- **NFR-13.** Account deletion SHALL be idempotent (safe to retry after partial
  failure).
- **NFR-16.** The parser is balance-reconciled and guarded by a stdlib unittest
  suite (`npm test`) over synthetic fixtures; chequing parses SHALL tie to the
  summary box.

### Scalability

- **NFR-17.** Hosted scaling SHALL be per-user (one DO + R2 prefix + KV namespace
  per account); there is no shared hot table to contend on.
- **NFR-18.** Self-host and hosted SHALL share `lib/db` behind the `Repo` seam;
  hosted is additive, never a fork (self-host + MCP stay green throughout).

### Maintainability

- **NFR-19.** `lib/db/*.ts` SHALL remain backend-agnostic synchronous SQL; the
  `DoSqlBackend` adapter bridges named params → positional for DO SQLite. New
  schema changes go through `lib/db/migrations/*.sql` (app/data DBs) and
  `d1/migrations/*.sql` (auth DB) — two databases, two migration sets, never
  cross-applied.
- **NFR-20.** Auth/session modules SHALL never import the DB (auth hot path; Edge
  runtime can't use `better-sqlite3`).
- **NFR-21.** UI SHALL use `@base-ui/react` (not radix) shadcn components and the
  brutalist design tokens in [DESIGN.md](../DESIGN.md).

---

## 7. External interfaces

### 7.1 PDF statement formats

| Format | Parse specifics |
|---|---|
| **Amex (Gold)** | Period = the **closing** date (2nd value in the header Opening/Closing pair); year = closing year; only Dec txns on a Jan-closing statement roll back a year. Note: chequing statements contain "American Express" lines, so Amex is the **fallback** route. |
| **CIBC Aeroplan Visa** | Description split from CIBC's fixed "Spend Categories" vocabulary (Retail and Grocery, Restaurants, Transportation, …). Wrong vocabulary silently skips rows. Period handles full month names. |
| **CIBC chequing** | `_walk_chequing()` core; direction from balance reconciliation; continuation lines folded; amounts stored positive, `flow` encodes direction; category `Banking`. Verify with `chequing_report(path)`. |

`MONEY_TOKEN` has guards (`(?!\d)` + FX-note) so exchange-rate lines aren't
parsed as transactions. *(FR-12, FR-13)*

### 7.2 Cloudflare bindings (hosted)

| Binding | Resource | Role | Provision |
|---|---|---|---|
| `USER_DATA` | Durable Object (`UserDataObject`) | per-user SQLite data (and the shared waitlist DO) | created on deploy via `[[migrations]]` |
| `DB` | D1 (`pare-auth`) | better-auth identity tables | `wrangler d1 create` → paste `database_id`; apply `d1/migrations` |
| `PDF_BUCKET` | R2 (`pare-pdfs`) | transient uploaded PDFs (`u/<userId>/…`) | `wrangler r2 bucket create` (binds by name) |
| `PARSE_QUEUE` | Queue (`parse-jobs`) | async parse jobs (producer + consumer) | `wrangler queues create` (binds by name) |
| `PARSE_JOBS` | KV | parse-job status records | `wrangler kv namespace create` → paste `id` |
| `PARSER` | Container (`ParserContainer`) | Python+poppler parser over HTTP | built/pushed on deploy via `[[containers]]` (needs Docker) |
| `RL_WAITLIST` / `RL_AUTH` | Rate Limiting (`[[unsafe.bindings]]`) | per-IP limits | deploy with Worker; fail-open |
| `ASSETS`, `WORKER_SELF_REFERENCE` | static assets / self-ref | OpenNext serving + cache | from build |

**Secrets (never committed):** `BETTER_AUTH_SECRET` (mandatory),
`BETTER_AUTH_URL`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `TURNSTILE_SECRET_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time, public), `SENTRY_DSN`,
`PARE_AUTH_SECRET` (cross-runtime session secret).

### 7.3 Auth interface (hosted)

better-auth (D1) — email/password, password-reset verification, **passkeys**
(`@better-auth/passkey`, the `passkey` table), and **bearer tokens** (the bearer
token *is* the session token; no extra table). Captcha plugin gated on
`TURNSTILE_SECRET_KEY`. The hosted sign-in/sign-up UI is **not yet built** (the
login page is still the self-host flow) — `[TBD]`.

### 7.4 Email (planned/optional)

**Resend** SHALL deliver hosted password-reset email (`RESEND_API_KEY`,
`AUTH_EMAIL_FROM`); the only user-facing third-party processor beyond Cloudflare
(+ Turnstile/Sentry). `[TBD: lifecycle/billing email scope]`

### 7.5 HTTP API (selected)

`/api/auth` (setup/login/logout/update_profile/change_password; GET status) ·
`/api/waitlist` (POST) · `/api/upload` (POST; hosted 202 + `/status`) ·
`/api/categories` · `/api/goals` · `/api/recurring` · `/api/networth` (GET/POST/
PUT/DELETE) · `/api/summary?type=…` (overview/baseline/income/cashflow/heatmap/
forecast/cashflow_forecast/net_worth/insights) · `/api/data` (export/wipe) ·
`/api/account` (hosted hard delete; GET `{hosted}` probe) · `/api/monitoring`
(client-error beacon).

---

## 8. Data model summary

### 8.1 Per-user data DB (self-host file / hosted DO) — `lib/db/migrations`

| Table / view | Key columns |
|---|---|
| `statements` | `filename` UNIQUE, `source`, `account`, `period`, `row_count`, `closing_balance`, `closing_date`, `account_kind` |
| `transactions` | `statement_id`→statements, `source`, `account`, `txn_date`, `description`, `amount`, `category`, `flow` (CHECK: spend/payment/income/transfer/fee_interest), `dedup_key` UNIQUE, `account_kind` (CHECK: card/chequing/savings/cash/investment/unknown), `import_id`→imports |
| `category_rules` | `category`, `keyword` UNIQUE, `sort_order` |
| `category_overrides` | `transaction_id` UNIQUE → transactions, `original_category`, `new_category` |
| `spending_goals` | `category` UNIQUE, `monthly_limit`, `active` |
| `manual_entries` | `name`, `kind` (asset/liability), `amount`, `effective_date`, `note` |
| `imports` | `provider`, `row_count`, `account_map`, `date_min/max` (migration 006, migration feature) |
| `waitlist` | `email` UNIQUE, `source` |
| `app_user` | single row (id=1): name, `password_hash` (scrypt), `password_changed_at` (self-host gate) |
| `v_transactions` (view) | `t.* , effective_category = COALESCE(override, category)` |

### 8.2 Auth DB (hosted, D1) — `d1/migrations`

| Table | Key columns |
|---|---|
| `user` | `id`, `name`, `email` UNIQUE, `emailVerified`, timestamps |
| `session` | `id`, `token` UNIQUE, `expiresAt`, `userId`→user (CASCADE) |
| `account` | `id`, `accountId`, `providerId`, `userId`→user, `password`, token fields |
| `verification` | `identifier`, `value`, `expiresAt` (password reset) |
| `passkey` | `publicKey`, `credentialID`, `counter`, `userId`→user (CASCADE) |

### 8.3 Ephemeral / KV (hosted)

- **R2** (`PDF_BUCKET`): uploaded PDF bytes under `u/<userId>/<uuid>-<filename>`;
  deleted post-parse.
- **KV** (`PARSE_JOBS`): parse-job records under `job/<userId>/…`
  (queued/parsing/done/failed + counts).

> Auth tables live **only** in D1; app tables live **only** in the per-user data
> DB. They are never cross-applied (NFR-19).

---

## 9. Constraints & assumptions

- **C1 — Runtime split.** Hosted runs on Cloudflare Workers (Edge for
  `middleware.ts`, which forbids `node:fs`/`node:crypto` — hence WebCrypto + env
  secret). Self-host runs on Node. The middleware stays on the `middleware.ts`
  (Edge) convention because Next 16's `proxy.ts` is Node-locked and OpenNext
  cannot bundle Node middleware.
- **C2 — `better-sqlite3` can't run on Workers.** Hosted reaches data through the
  `Repo` seam over `DoSqlBackend` (native DO SQLite). The adapter translates
  named placeholders → positional and maps `.transaction()` →
  `transactionSync()`.
- **C3 — Cloudflare Containers don't emulate locally.** Container parsing is
  tested with Docker / mocked endpoints; R2 + Queues + KV emulate under
  miniflare.
- **C4 — Workers Paid required.** Queues and Containers require the Workers Paid
  plan; the live full deploy is held on it plus Docker, R2/Queues token scopes,
  and a Resend key (PRD §7 launch gate).
- **C5 — Statements lag the calendar.** "Current" views key off the latest data
  month, not `new Date()`; net worth and the cash-flow forecast are point-in-time
  off the latest reconciled anchor.
- **C6 — Retention default-off.** Hosted PDFs are not persisted; any future
  retention is an explicit opt-in (`[TBD]`).
- **C7 — Self-host prerequisites.** Node 18+, Python 3.10+, poppler
  (`pdftotext`).
- **C8 — PII discipline.** Personal merchants, the e-transfer handle, and
  absolute home paths stay out of tracked source; the tracked taxonomy is generic
  (`STARTER_RULES` / `categories.py`), the tuned list is gitignored.

---

## 10. Open items (`[TBD]`)

Tracked jointly with PRD §9: hosted sign-in/sign-up UI; Monarch/Mint/YNAB import
field mapping; Expo client details; billing cap/price/processor; statement-format
expansion roadmap; custom domain (`app.pare.money`) cutover; hosted-MCP scope;
data-retention opt-in.
