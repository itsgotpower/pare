# Pare

**The fastest way to have more money is to keep more.**

Pare is a privacy-first personal finance app. It parses your bank and credit-card
**PDF statements** into categorized transactions and shows spending trends,
cash-flow forecasts, net worth, and budget goals — **no account aggregators, no
bank logins, no data selling.** Your statements, your machine, your data.

> Most finance apps work by holding your bank credentials and pulling your data
> through a third-party aggregator. Pare doesn't. You upload a PDF; a parser reads
> it; the numbers land in a database only you can reach.

## Who it's for

- **The Mint refugees.** Mint shut down. Pare ingests the same statements without
  handing your logins to anyone.
- **People priced off Monarch / Copilot / YNAB** who want the dashboard without
  the subscription or the cloud sync.
- **Privacy-first users** who will not connect their bank to a third party — and
  who want the *option* to run the whole thing on their own hardware.
- **People who already live in the terminal / Claude.** Pare ships a finance MCP
  server, so you can ask Claude about your spending over a local database.

## What's live

- **Waitlist — [pare.money](https://pare.money).** The hosted, multi-user app is
  in active development; join the list to get an invite when it opens.
- **Self-host — today.** The entire app is in this repo and runs on your machine
  right now. Single-user, local-first, zero network calls. See
  [Self-host quickstart](#self-host-quickstart).

Same codebase, two deploy targets. Self-host is not a stripped demo — it's the
product, minus the multi-tenant plumbing.

## Self-host quickstart

**Prerequisites**

- Node.js 18+ (CI builds on 22)
- Python 3.10+
- poppler (`pdftotext`) — `brew install poppler` (macOS) · `apt install poppler-utils` (Debian/Ubuntu)

**Run it**

```bash
git clone https://github.com/itsgotpower/pare.git
cd pare
npm install
npm run dev
```

Open <http://localhost:3000>. First run prompts you to create a profile (the
single-user gate). Drop a statement PDF on `/upload` — Amex, CIBC Visa, or CIBC
chequing are supported today — and the dashboard fills in. No statement parser for
your bank yet? Most banks let you **export `.ofx` / `.qfx`** ("Download to
Quicken/Money"); drop that on `/upload` instead and Pare reads it directly —
deduped on each transaction's bank-assigned ID, so re-importing never doubles up.

Your data lives in `data/pare.db` (a local SQLite file) plus
`data/user-rules.json` for your category rules. **The entire `data/` directory is
gitignored and never leaves your machine.** Keep real statement PDFs *outside*
the repo (the parent directory is fine).

**Other commands**

```bash
npm run mcp                                          # finance MCP server (stdio) over data/pare.db
python3 lib/parser/parse_statements.py <dir> --json  # run the PDF parser standalone
npm test                                             # parser regression suite (synthetic fixtures)
```

See [mcp/README.md](mcp/README.md) for wiring the MCP server into Claude, and
[CONTRIBUTING.md](CONTRIBUTING.md) for tests and the PR flow.

## Architecture

One query layer (`lib/db`) sits behind an async `Repo` seam, so the **same SQL
runs on both targets** — the deploy target just picks the backend.

| | Self-host (today) | Hosted (Cloudflare) |
|---|---|---|
| Runtime | Node (Next.js 16) | Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) |
| Per-user data | `better-sqlite3` file DB | **one Durable Object per user**, on native DO SQLite (`ctx.storage.sql`) |
| Auth | single-user gate (scrypt + HMAC cookie) | **better-auth** on D1 (email/password, passkeys, password reset, bearer tokens) |
| PDF parsing | Python + poppler via `child_process` | Python + poppler in a **Cloudflare Container** |
| Upload pipeline | parse inline | **R2** (store) → **Queues** (job) → Container (parse) → write to user's DO → PDF deleted |

```
Hosted (Cloudflare)                          Self-host (your machine)
─────────────────────────────────────        ──────────────────────────────
Next.js 16 (App Router) on Workers            Next.js 16 (App Router) on Node
   │                                             │
   ├─ better-auth on D1                          ├─ single-user gate (HMAC cookie)
   ├─ per-user Durable Object (SQLite)           ├─ better-sqlite3 file DB
   └─ upload: R2 → Queue → Container             └─ upload: parse inline
                       (Python + poppler)                       (Python + poppler)
```

**Tenant isolation is by construction.** In hosted mode a request routes to
exactly one user's Durable Object, each backed by its own SQLite database. A
forgotten `WHERE user_id = ?` can't leak another account's rows — that class of
bug doesn't exist here.

**Stack:** Next.js 16 · TypeScript · SQLite (better-sqlite3 / native DO SQLite) ·
Python 3 + poppler · Cloudflare Workers, Durable Objects, D1, R2, Queues,
Containers · Recharts · Tailwind CSS 4 + shadcn/ui ([brutalist bento
theme](DESIGN.md)).

## Privacy posture

Concrete, not a slogan:

- **No aggregators, no bank logins.** Pare never touches your credentials. It
  reads statement PDFs you already have.
- **Per-user isolation in the hosted app.** Every account gets its own Durable
  Object database — physical separation, not a shared table with a `user_id`
  column.
- **PDFs are ephemeral in the hosted pipeline.** An uploaded PDF is parsed and
  then **deleted** from R2 — only the extracted rows persist.
- **No data selling. No ad tech.** There is no business model that involves your
  transactions leaving your control.
- **Self-host = fully local.** Run it yourself and there are zero outbound calls;
  your DB is a file on your disk.

See [SECURITY.md](SECURITY.md) for the data-handling rules and how to report a
vulnerability.

## Status

- **Rebrand Parse → Pare:** done.
- **Self-host:** shipping today — PDF parsing, categorization, dashboard,
  forecasts, net worth, goals, MCP server.
- **Hosted (Cloudflare):** built through Phase 4 hardening — multi-user
  better-auth, per-user Durable Object SQLite, the R2 + Queues + Container upload
  pipeline, rate limiting, Turnstile, error tracking, and account deletion.
- **Waitlist:** live at [pare.money](https://pare.money).
- **Full public launch:** held on a few prerequisites — provisioning the
  production Cloudflare resources, a custom domain, and billing. Self-host mode
  and the MCP server stay green throughout; hosted is additive, not a fork.

## Links

- **Waitlist / product:** [pare.money](https://pare.money)
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security & privacy:** [SECURITY.md](SECURITY.md)
- **License:** [AGPL-3.0](LICENSE) core, [proprietary](cloud/LICENSE) `cloud/`

## License

**Open core.** Everything in this repository is licensed under the
[GNU AGPL-3.0](LICENSE) **except the [`cloud/`](cloud/) directory** — the
hosted-product layer (billing, hosted email ingest, metering), which is
source-visible but proprietary under its own [commercial license](cloud/LICENSE).

The AGPL core is the complete self-hosted product; nothing in `cloud/` is
required to run it. Run it, modify it, self-host it — and if you offer a
modified version as a network service, you have to share your source with its
users.

Copyright (C) 2026 pare.money.
