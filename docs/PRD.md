# Pare — Product Requirements Document

> **The fastest way to have more money is to keep more.**

Pare turns the bank and credit-card statements you already get into a clear
picture of where your money goes — and keeps every byte of it under your control.
No bank logins, no aggregators, no data resale.

- **Status:** waitlist-only public landing live at [pare.money](https://pare.money);
  self-host shipping today; hosted multi-user build complete (Phases 0–4) and
  held on infrastructure provisioning (see [Roadmap](#7-roadmap)).
- **Companion spec:** functional and non-functional requirements are numbered in
  [SRS.md](SRS.md). Feature → requirement cross-references appear inline below.
- **Source of record:** this document and the SRS are the canonical product +
  requirements reference. Behavioural detail lives in [CLAUDE.md](../CLAUDE.md);
  the privacy model in [SECURITY.md](../SECURITY.md); deployment in
  [DEPLOY.md](../DEPLOY.md).

---

## 1. Product summary

Pare is a privacy-first personal finance app. You drop in PDF statements from
your bank and credit cards; a balance-reconciled parser extracts every
transaction, categorizes it with keyword rules you can tune, and renders the
result as a brutalist-bento dashboard — monthly trends, category breakdowns,
income vs. spend, net cashflow, a discretionary-spending baseline, a money-flow
Sankey, a daily-spend heatmap, a 30/60/90-day cash-flow forecast, net worth over
time, subscription detection, budget goals, and rule-based insights.

It ships in **two deploy targets from one codebase**, behind an async `Repo`
seam so the same `lib/db` SQL runs on both:

| | Self-host | Hosted (Cloudflare) |
|---|---|---|
| Who it's for | runs entirely on your machine | we run it; you sign up |
| Runtime | Node (Next.js) | Cloudflare Workers via OpenNext |
| Per-user data | `better-sqlite3` file DB | **Durable Object per user** (native DO SQLite) |
| Auth | single-user gate (scrypt + HMAC cookie) | **better-auth** on D1 (email/password, passkeys, bearer tokens) |
| PDF parsing | Python + poppler via `child_process` | Python + poppler in a **Cloudflare Container** |
| Upload | parsed inline | **R2 → Queue → Container → user's DO → PDF deleted** |
| Cost | free, forever | free tier + paid tier *(see [Pricing](#6-pricing))* |

The differentiator beyond features is **architecture**: in hosted mode each
account is backed by its own Durable Object database, so a request routes to
exactly one user's store. Tenant isolation is *by construction* — a forgotten
`WHERE user_id = ?` cannot leak another user's rows because that query path does
not exist.

### Value proposition

1. **Keep more of what you make.** Pare's job is to make overspending and silent
   subscription creep impossible to miss — that's the money it saves you.
2. **Your statements, not your credentials.** Pare never asks for a bank login
   and never connects to an aggregator. You feed it the PDFs your bank already
   sends you.
3. **Your data stays yours.** Self-host and it never leaves your machine. Hosted,
   it lives in an isolated per-user database and uploaded PDFs are shredded the
   moment they're parsed.
4. **Talk to it.** A Model Context Protocol server lets Claude query and edit
   your finances directly (self-host today), so you can build a budget by
   conversation instead of by spreadsheet. This is the current public landing
   headline: *"Talk to Claude about your money."*

---

## 2. Target users & use cases

### Primary persona — the privacy-conscious switcher

People who actively track their spending and are unwilling (or no longer able) to
hand a third party their bank credentials:

- **Mint refugees.** Mint shut down; its users were pushed to Credit Karma and
  ad-driven products.
- **Monarch / YNAB / aggregator-fatigued users.** Comfortable paying for finance
  software, but uneasy that it brokers a live connection to every account through
  Plaid-style aggregators, or sells/monetizes the data behind it.
- **Self-hosters & developers.** Want a local-first tool they can run, read, and
  audit (Pare is MIT-licensed and open source).

### Secondary persona — the Claude / MCP user

People already working with Claude who want it to reason over their real
finances. The MCP server (16 read/write tools) makes Pare a finance backend
Claude can drive directly.

### Use cases

- **Ingest a month of statements** → see categorized spend in minutes, no manual
  entry. *(FR-10…FR-16)*
- **Find where the money actually goes** — category donut, Sankey, daily
  heatmap, top merchants. *(FR-30…FR-37)*
- **Catch subscription creep** — recurring-charge detection across 3+ months,
  with variable-amount and double-bill flags. *(FR-50…FR-52)*
- **Answer "will I make it to payday?"** — 30/60/90-day cash-flow forecast
  anchored to the latest reconciled balance. *(FR-40…FR-44)*
- **Stay on budget** — per-category monthly limits with green/yellow/red
  progress and suggested limits from a 6-month average. *(FR-38)*
- **Track net worth without linking accounts** — statement closing balances +
  manual entries for investments/vehicles. *(FR-45…FR-47)*
- **Build a budget by talking to Claude** — over MCP (self-host). *(FR-60…FR-61)*
- **Leave another app** — import history from Monarch/Mint/YNAB. *(FR-70, planned)*

---

## 3. Goals & non-goals

### Goals

- **G1 — Zero-credential ingestion.** Everything works from PDF statements the
  user already receives. No bank login, ever.
- **G2 — Isolation by construction (hosted).** Per-user Durable Object DBs so
  cross-tenant leakage is structurally impossible, not merely policed.
- **G3 — Ephemeral PDFs (hosted).** Uploaded statements are deleted immediately
  after parsing; retention is default-off.
- **G4 — One codebase, two targets.** Self-host and hosted share `lib/db` behind
  the `Repo` seam; hosted is additive, never a fork.
- **G5 — Trustworthy numbers.** Parsing is balance-reconciled; forecasts are
  framed as estimates, not promises; statement-lag is surfaced rather than hidden.
- **G6 — Local-first by default.** Self-host makes zero outbound network calls
  and emits no telemetry.

### Non-goals

- **N1 — No aggregator / open-banking connections.** No Plaid, no Flinks, no
  scraping bank logins. PDFs only.
- **N2 — No selling, brokering, or ad-targeting of financial data.** Ever.
- **N3 — Not a bank or a payments product.** Pare never moves money, executes
  trades, or initiates transfers.
- **N4 — Not real-time.** Data follows statement cadence; net worth and current
  month are point-in-time, computed from the latest data month (statements lag
  the calendar).
- **N5 — Not a generic CSV importer (today).** The legacy CSV-import path was
  removed because period-start dates created silent duplicates. The Monarch/Mint
  import (Roadmap) is the deliberate, provenance-tracked replacement.

---

## 4. Key features

Each feature links to its functional requirements in [SRS.md](SRS.md).

### Shipping today (self-host) / built (hosted)

| Feature | What it does | SRS |
|---|---|---|
| **PDF ingestion** | Drag-drop Amex Gold, CIBC Aeroplan Visa, CIBC chequing; balance-reconciled Python parser extracts transactions + statement metadata (closing balance/date) | FR-10…FR-16 |
| **Smart categorization** | First-match keyword rules + seed dictionary; user rules persist across DB rebuilds; recategorize-all; override→rule suggestions | FR-20…FR-25 |
| **Deduplication** | SHA-256 hash per transaction (`source\|date\|description\|amount\|seq`) blocks double-imports | FR-17 |
| **Dashboard — Overview** | Monthly bars, category donut, totals, goals, top merchants | FR-30 |
| **By category / Income / Baseline** | Per-category trends; income vs. spend + net cashflow; discretionary baseline (large one-offs removed) | FR-31…FR-33 |
| **Cashflow Sankey + heatmap** | Money-flow Sankey (income → hub → categories → saved); daily-spend calendar heatmap; same-month forecast | FR-34…FR-35 |
| **Cash-flow forecast** | 30/60/90-day projection from latest reconciled chequing balance, ±1σ uncertainty band | FR-40…FR-44 |
| **Net worth** | Statement-cadence trend (closing balances signed by account kind) + manual asset/liability entries | FR-45…FR-47 |
| **Insights** | Local rule-based tips: over/near-budget, MoM moves, surplus/deficit, large one-offs, forecast pace | FR-36…FR-37 |
| **Transactions** | Searchable/filterable table, spend/all tabs, pagination | FR-30 |
| **Recurring detection** | Subscriptions by cadence + stable amount or known-merchant keyword; monthly/annual totals, variable + double-bill flags | FR-50…FR-52 |
| **Budget goals** | Per-category monthly limits, green/yellow/red bars, suggested limits from 6-mo avg | FR-38 |
| **Finance MCP server** | Local stdio MCP, 16 read/write tools, over `data/pare.db` (self-host) | FR-60…FR-61 |
| **Data export / wipe** | CSV / JSON / full backup export; confirmed destructive wipe | FR-25, FR-82 |
| **Multi-user auth (hosted)** | better-auth on D1 — email/password, password reset, passkeys/WebAuthn, bearer tokens | FR-1…FR-6 |
| **Per-user data (hosted)** | One Durable Object DB per account, native DO SQLite | FR-30, NFR-7 |
| **Async upload pipeline (hosted)** | R2 → Queue → Container parser → user's DO → PDF deleted; job-status polling | FR-12…FR-16 |
| **Account deletion (hosted)** | `DELETE /api/account` hard-deletes across DO + R2 + KV + D1, idempotent, PII-free audit log | FR-80…FR-81 |
| **Production hardening (hosted)** | Per-IP rate limits, Turnstile, Sentry (PII-redacted), public `/privacy` | NFR-12…NFR-15 |

### Planned

| Feature | What it does | SRS |
|---|---|---|
| **Monarch / Mint / YNAB import** | Provenance-tracked history import via `account_kind` + `imports` table; one-click rollback | FR-70 (planned) |
| **Expo mobile app** | iOS/Android client on the same hosted API via bearer tokens; share-sheet PDF ingest into the existing upload endpoint | FR-71 (planned) |
| **Billing + public launch** | Free tier + paid tier; open hosted sign-up | FR-72 (planned), §6 |

---

## 5. Success metrics

| Stage | Metric | Why |
|---|---|---|
| **Now (waitlist)** | Waitlist signups; signup→confirmation rate on the landing | The only live funnel; demand signal before the data plane is provisioned |
| **Now (self-host)** | GitHub stars / forks / clones; MCP server installs | Proxy for developer adoption of the open-source path |
| **Closed beta** | Activation = % of signups who upload ≥1 statement and see a categorized dashboard | Proves the core loop works for strangers' real statements |
| **Post-launch** | MAU; D30 retention; statements uploaded per active user | Sustained value, not one-time curiosity |
| **Post-launch** | Categorization accuracy (% auto-categorized, override rate) | Quality of the core parse→categorize loop |
| **Post-launch (hosted cost)** | Storage + compute per active user; PDF parse success rate | Unit economics for pricing; parser reliability across statement formats |
| **Post-billing** | Free→paid conversion; paid retention; MRR | Business viability |

*Targets:* `[TBD]` — concrete numeric goals per metric to be set with Scott.

---

## 6. Pricing

- **Self-host — free, forever.** MIT-licensed; runs on the user's own machine
  with no network calls.
- **Hosted — free tier with a usage cap, plus a paid tier** for higher limits
  and/or additional features. The landing already commits to *"Free to start when
  the hosted version opens."*
- **Specifics `[TBD]`:** exact cap dimension (e.g. statements/month, accounts, or
  storage), paid price points, and what (if anything) is paid-tier-exclusive vs.
  free. Billing is a dedicated roadmap phase.
- **Never:** data sale, ad targeting, or monetizing financial data — that is a
  non-goal (N2), not a pricing lever.

Email delivery for the hosted plan (password reset, and later billing/lifecycle)
runs through Resend; this is the only third-party processor in the user-facing
path beyond Cloudflare (and Turnstile/Sentry, both PII-minimized).

---

## 7. Roadmap

Phase status mirrors [README.md](../README.md) and the phase planning docs.

| Phase | Scope | Status |
|---|---|---|
| **0** | Cloudflare scaffolding (OpenNext build/bundle for Workers) | ✅ Done |
| **1** | Async `Repo` layer (self-host file DB + Durable Object SQLite) | ✅ Done |
| **2** | Multi-user auth (better-auth/D1) + per-user Durable Objects | ✅ Done |
| **3** | R2 + Queues + Container upload pipeline (ephemeral PDFs) | ✅ Done |
| **4** | Production hardening — Edge-runtime auth gate, rebrand to pare.money, rate limits, Turnstile, Sentry, account deletion, `/privacy` | ✅ Done |
| **Launch gate** | **Waitlist-only landing live at pare.money.** Full multi-user deploy **held** on: Workers Paid plan, Docker (container image build), R2/Queues token scopes, Resend API key | ⏳ Held |
| **5** | Expo mobile app — share-sheet PDF ingest on the same hosted API (bearer tokens) | Planned |
| **5+** | Monarch / Mint / YNAB migration tool (schema groundwork landed: `imports` table + `account_kind`, migration 006) | Planned |
| **6** | Billing + public hosted launch | Planned |

**What's blocking the live hosted deploy** (from [DEPLOY.md](../DEPLOY.md) /
[PHASE4.md](../PHASE4.md), all account/infra, not code):
- Cloudflare **Workers Paid** plan (Queues + Containers require it)
- A working **Docker** daemon to build/push the parser container image
- **R2 + Queues token scopes** on the deploy credential
- **Resend API key** (+ `AUTH_EMAIL_FROM`) for password-reset email
- D1 `database_id` + KV `id` pasted into `wrangler.toml` (placeholders today)
- Optional Phase-4 hardening secrets: `TURNSTILE_SECRET_KEY` +
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `SENTRY_DSN`; custom-domain zone for
  `app.pare.money` (beta runs on `workers.dev`)

The hardening layer is **fail-open / inert until provisioned** — an
un-provisioned deploy behaves exactly like Phase 3.

---

## 8. Privacy & security positioning

This is a feature, not a footnote. Full model in [SECURITY.md](../SECURITY.md);
requirements in [SRS.md](SRS.md) §NFR (Security/Privacy).

- **Self-host:** zero outbound requests, no telemetry; all parsing and
  categorization happens locally. Financial data and personal category rules
  (e.g. the rent e-transfer handle) live only in the gitignored `data/` directory
  and never enter tracked source. *(NFR-9, NFR-11)*
- **Hosted — isolation by construction:** one Durable Object database per user;
  no shared multi-tenant table to mis-query. *(G2, NFR-7)*
- **Hosted — ephemeral PDFs:** uploaded statements are deleted from R2
  immediately after parsing; retention is default-off (no persistence unless a
  future opt-in setting). *(G3, NFR-10)*
- **Hosted — hard delete:** account deletion erases the user across all four
  stores (DO, R2, KV, D1) idempotently, logging only a PII-free audit line with a
  hashed user id. *(FR-80)*
- **Error tracking is PII-redacted:** Sentry `beforeSend` strips
  Authorization/Cookie/captcha headers, request bodies, and query strings, and
  masks email addresses; it's a no-op unless `SENTRY_DSN` is set. *(NFR-14)*
- **No aggregators, no credentials, no data sale.** *(N1, N2)*
- **Open source (MIT).** The privacy claims are auditable, not just asserted.

---

## 9. Open questions / `[TBD]`

These need Scott's input; they are unresolved in the source material:

1. **Pricing specifics** — free-tier cap dimension + value, paid price points,
   and free-vs-paid feature split.
2. **Success-metric targets** — concrete numbers for activation, retention, MAU,
   parse success, and free→paid conversion.
3. **Statement-format coverage roadmap** — Pare parses Amex Gold, CIBC Aeroplan
   Visa, and CIBC chequing today. Which banks/cards come next, and in what order?
   (Each new format is parser work + a fixture suite.)
4. **Custom domain** — beta runs on `workers.dev`; when does `app.pare.money` go
   live (Phase 4 has it commented-ready in `wrangler.toml`)?
5. **Hosted MCP** — MCP is self-host-only today (local DB). Is a hosted MCP
   surface (bearer-auth'd against the user's DO) in scope, and for which phase?
6. **Data retention opt-in** — is there a planned user setting to *keep* uploaded
   PDFs (retention is default-off but the code anticipates an opt-in)?
