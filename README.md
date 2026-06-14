# Pare

Privacy-first personal finance. Pare parses your bank and credit-card **PDF statements** into categorized transactions and shows spending trends, cash-flow forecasts, net worth, and budget goals — without aggregators, bank credentials, or data selling.

> **Every user gets their own isolated database.** Self-host it for free, or (soon) pay us to host it. Same codebase, two deploy targets.

- **Self-host** — local-first, single-user, runs entirely on your machine. No network calls, no telemetry. *(Shipping today.)*
- **Hosted (Cloudflare)** — multi-user, each account backed by its own per-user database, built so no query *can* return another user's rows. *(Built — Phases 0–3 — pre-launch; see [Status](#status).)*

See [SECURITY.md](SECURITY.md) for the privacy model and pre-publish checklist.

## Features

- **PDF ingestion** — drag-and-drop Amex, CIBC Visa, and CIBC chequing statements; a balance-reconciled Python parser extracts transactions and statement metadata automatically
- **Smart categorization** — first-match keyword rules with a seed dictionary; add your own via the UI and they persist across DB rebuilds
- **Dashboard** — monthly bars, category donut, top merchants, income vs. spend, net cashflow, a discretionary-baseline view, a money-flow **Sankey**, a daily-spend **heatmap**, a **30/60/90-day cash-flow forecast**, **net worth** over time, and rule-based **insights**
- **Transactions** — searchable, filterable table with spend/all views and pagination
- **Recurring detection** — finds subscriptions and recurring charges by cadence + amount
- **Budget goals** — monthly limits per category with progress bars (green / yellow / red)
- **Deduplication** — SHA-256 hash per transaction prevents double-imports
- **Finance MCP server** — a local [Model Context Protocol](https://modelcontextprotocol.io) server (16 read/write tools) so Claude can query and edit your finances over `data/pare.db` (self-host)

## Architecture

The query layer sits behind an async `Repo` interface, so the **same `lib/db` SQL** runs on both targets — the deploy target just picks the backend:

| | Self-host | Hosted (Cloudflare) |
|---|---|---|
| Runtime | Node (Next.js) | Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) |
| Per-user data | `better-sqlite3` file DB | **Durable Object per user**, on native DO SQLite (`ctx.storage.sql`) |
| Auth | single-user gate (scrypt + HMAC cookie) | **better-auth** on **D1** (email/password, password reset, bearer tokens) |
| PDF parsing | Python + poppler via `child_process` | Python + poppler in a **Cloudflare Container** (HTTP) |
| Upload pipeline | parse inline | **R2** (store) → **Queues** (job) → Container (parse) → write to the user's DO → PDF deleted |

```
[Next.js app + API — Workers via OpenNext]
        │
        ├── Auth: better-auth on D1
        ├── Per-user data: Durable Object w/ native SQLite, one per user
        ├── Upload: R2 (per-user prefix) → Queue → Container (parse_statements.py)
        │            → rows written to the user's DO → PDF deleted post-parse
        └── Mobile (planned): Expo app on the same API (bearer tokens)
```

Tenant isolation is **by construction**: a request routes to exactly one user's Durable Object, so a forgotten `WHERE user_id = ?` can't leak data — that class of bug doesn't exist here.

## Stack

- Next.js 16 (App Router, TypeScript)
- SQLite — `better-sqlite3` (self-host) / native Durable Object SQLite (hosted), behind an async `Repo` seam (`lib/repo/`)
- Python 3 + `pdftotext` (poppler) for PDF parsing
- Cloudflare Workers · Durable Objects · D1 · R2 · Queues · Containers (hosted target)
- Recharts · Tailwind CSS 4 + shadcn/ui (brutalist bento theme)

## Prerequisites (self-host)

- Node.js 18+
- Python 3.10+
- poppler (`pdftotext`) — `brew install poppler` on macOS

## Getting started (self-host)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload a PDF statement on `/upload`. The first run prompts you to create a profile (the single-user gate).

### PDF parser (standalone)

```bash
python3 lib/parser/parse_statements.py <pdf-directory> --json
```

### Finance MCP server

```bash
npm run mcp        # stdio MCP server over data/pare.db; see mcp/README.md
```

## Hosted deployment (Cloudflare)

The hosted target is built and tested but **pre-launch** — see [DEPLOY.md](DEPLOY.md) for the full provisioning sequence (D1 + migrations, R2 bucket, queue, KV, secrets, container) and `npm run cf:deploy`. One blocker remains before a live deploy: porting the Node-runtime auth middleware (`proxy.ts`) to the Edge runtime so the OpenNext bundle builds (tracked for Phase 4).

## Project structure

```
app/              Next.js App Router pages + API routes
lib/
  db.ts           SQLite singleton (self-host) + connection override hook
  db/             Query layers (categories, income, goals, forecast, …) + migrations
  repo/           Async Repo seam — SqliteRepo (file) + DoSqlBackend (Durable Object SQLite)
  auth/           Single-user gate (self-host) + better-auth (hosted)
  parser/         Python PDF parser + container HTTP wrapper + ParserService
  queue/          Queues producer/consumer + job store (hosted upload pipeline)
  storage/        R2 PDF store
worker.ts         Cloudflare Worker entry (fetch + queue handlers, DO classes)
wrangler.toml     Cloudflare bindings (D1, DOs, R2, Queue, KV, Container)
mcp/              Finance MCP server
data/             Runtime data — DB, user rules (gitignored)
```

## Status

| Phase | | |
|---|---|---|
| 0 | Cloudflare scaffolding (OpenNext) | ✅ |
| 1 | Async `Repo` layer (self-host + DO) | ✅ |
| 2 | Multi-user auth + per-user Durable Objects | ✅ |
| 3 | R2 + Queues + Container upload pipeline | ✅ |
| 4 | Production hardening + first deploy | ⏳ next |
| 5 | Expo mobile app (share-sheet ingest) | planned |
| 6 | Billing + public launch | planned |

Self-host mode and the MCP server stay green throughout — hosted is additive, not a fork.

## License

**Open core.** This repository — the entire self-hostable product — is licensed
under the **GNU AGPL-3.0** ([LICENSE](LICENSE)). Run it, modify it, self-host it
freely; if you offer a *modified* version as a network service, you must share
your source with its users.

The commercial layer that runs the paid hosted service (billing, metering,
account lifecycle) lives in a separate private repository and is proprietary.
See [LICENSING.md](LICENSING.md) for the full open-core boundary and the
contributor (CLA) terms.
