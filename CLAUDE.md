@AGENTS.md

# Parse

Local-first personal finance app. Parses bank/CC PDF statements, categorizes transactions, shows spending trends, tracks budget goals.

## Stack
- Next.js 15 (App Router, TypeScript)
- SQLite via better-sqlite3 (data/parse.db)
- Recharts for charts
- Tailwind CSS 4 + shadcn/ui (brutalist theme — zero border-radius, monochrome, monospace headers)
- Python parser called via child_process for PDF ingestion (requires pdftotext / poppler)

## Design System
Brutalist bento aesthetic. 1px borders, no rounded corners (--radius: 0), JetBrains Mono for headings (ALL-CAPS), Geist for body. See globals.css for theme variables.

Colour is reserved for DATA, not chrome: a muted earth-tone palette in `lib/colors.ts` (`PALETTE`, `CATEGORY_COLORS`, `categoryColor(name)` with a deterministic fallback). Use `categoryColor()` for any per-category fill/dot/bar so colours stay consistent across the donut, by-category bars, transaction badges, goal bars, and category-page dots. Borders/type/layout stay monochrome. Goal bars: category colour normally, `PALETTE.mustard` at 80–100%, `PALETTE.terracotta` over budget.

## Privacy
ALL financial data is PII. Never commit real transactions, PDFs, or the SQLite database. The data/ directory is gitignored. Only synthetic/redacted fixtures in tests.
**Tracked source ships a GENERIC taxonomy only** — `STARTER_RULES` (lib/db/categories.ts) and `lib/parser/categories.py` contain universal merchants/patterns, no personal merchants. The real, tuned keyword list lives in gitignored `data/seed-rules.json` (`loadSeedRules`), used as the seed source when present. Keep personal merchant names, the e-transfer handle, and absolute home paths OUT of tracked source (tests + helpers use synthetic data / `process.cwd()`-relative paths).

## Pages (app/)
- `/` — Dashboard: OVERVIEW (monthly bar, category donut, totals, goals, top merchants) + BY CATEGORY + INCOME + BASELINE tabs. BASELINE tab (lib/db/baseline.ts, /api/summary?type=baseline&threshold=N): discretionary baseline = card spend with single charges ≥ threshold removed; total-vs-baseline bars, baseline-avg vs total-avg, $200/$300/$500 threshold control, and a transparent excluded-one-offs list. INCOME tab driven by lib/db/income.ts (income-vs-spend grouped bars, income-by-type donut, totals); income type derived from description (PEOPLE CENTER→Payroll, REMBOURS/REFUND→Tax refund, etc.). INCOME tab also shows net cashflow: per-month net bar chart (sage surplus / terracotta deficit) + NET THIS MONTH (with MoM delta) + PERIOD SURPLUS cards, computed client-side as income − card spend for months with chequing data. NOTE: net does not yet subtract rent (flow=transfer) — pending the rent include/exclude task.
- INSIGHTS panel sits at the top of the dashboard (above the tabs, always visible): local rule-based tips from `lib/db/insights.ts` (/api/summary?type=insights) — over/near-budget goals, MoM category moves, net surplus/deficit, large one-offs, top category; severity-sorted & colour-dotted. All heuristics use the **latest data month**, not the calendar month.
- `getCurrentProgress` (goals) and insights both use the latest month with spend data (statements lag the calendar). Don't switch these back to `new Date()` month — it would show empty current-month data.
- Layout uses a collapsible left **Sidebar** (`components/layout/navbar.tsx`, exports `Sidebar`) with lucide icons + dark-mode toggle; not a top navbar.
- `/transactions` — searchable/filterable table, SPEND/ALL flow tabs, pagination
- `/recurring` — subscription/recurring detection (lib/db/subscriptions.ts, /api/recurring): merchants charged across 3+ months by stable-amount+cadence or known-merchant keyword; monthly/annual totals, frequency, variable-amount + double-bill flags
- `/upload` — drag-drop PDF only (the CSV-import button/route were REMOVED — they duplicated PDF data; see Data provenance)
- `/categories` — rule CRUD grouped by category, override→rule suggestions, recategorize-on-add
- `/goals` — monthly limits, progress bars (green<80 / yellow<100 / red over), suggested limits from 6-mo avg

## Commands
- `npm run dev` — start dev server (localhost:3000)
- `npx next build` — type-check + build (run before declaring done)
- `npm test` — parser regression suite (stdlib unittest, synthetic fixtures in `tests/`, no PDFs/real data). Run after touching `lib/parser/*.py` or `categories.py`. Tests monkeypatch `parse_statements.text` and assert reconciliation/flows/vocab/date-inference/categorizer behaviour.
- `npm run mcp` — start the finance MCP server (stdio). Reuses `lib/db`; reads/writes `data/parse.db`. 16 read+write tools. Set `PARSE_DB_PATH` to the absolute DB path when launched by an MCP client (cwd is unknown). Smoke test: `npx tsx mcp/test-client.ts`. See `mcp/README.md` for tools + Claude Code config. db.ts honors `PARSE_DB_PATH` (falls back to `<cwd>/data/parse.db`).
- `python3 lib/parser/parse_statements.py <dir> <out.csv>` — run PDF parser standalone (or `<dir> --json` for JSON)

## Key Patterns
- API routes in app/api/*/route.ts use Web Request/Response API (Next 15, `request.formData()` native)
- SQLite singleton in lib/db.ts (WAL mode, foreign keys ON); query layers in lib/db/*.ts
- Migrations in lib/db/migrations/*.sql, applied by lib/db/migrate.ts at first getDb()
- Category rules seeded from gitignored `data/seed-rules.json` (personal taxonomy) if present, else generic `STARTER_RULES` in lib/db/categories.ts; first-match-wins. The Python parser ships generic too, so `/api/upload` calls `recategorizeAll()` after inserts to apply the DB's full rules to new transactions.
- Dedup: SHA-256 hash of (source|txn_date|description|amount|seq), INSERT OR IGNORE
- Only flow='spend' from amex/cibc_visa counts toward spend charts (v_transactions view resolves overrides)

## Gotchas
- **shadcn here uses @base-ui/react, NOT @radix-ui.** DialogTrigger has no `asChild` — render the trigger as its own styled element. Tabs use `@base-ui/react/tabs` and support a `line` variant + vertical orientation.
- **Dev server caches the SQLite connection in memory.** After deleting data/parse.db or changing schema/migrations, restart `npm run dev` — the in-process singleton won't pick up a fresh file otherwise.
- **CSV from Start/ has Windows \r line endings.** Strip with `.replace(/\r/g, "")` before parsing or the trailing `flow` value fails the CHECK constraint and rows get silently dropped by INSERT OR IGNORE.
- Recharts Tooltip `formatter` types want `(value) => ...` then `Number(value)` — typing the param as `number` fails the build.

## Parser (lib/parser/parse_statements.py)
PDF type routing in main() order matters: **Aeroplan+Visa → CIBC Account Statement → American Express (fallback)**. Chequing statements contain "American Express" (Amex card-payment lines), so checking Amex first misroutes them. Run standalone: `python3 lib/parser/parse_statements.py <dir> --json`.

- **Amex:** period = the CLOSING date (header value line has Opening + Closing; take the 2nd). Year = closing year; only Dec txns on a Jan-closing statement roll back a year.
- **CIBC Visa:** splits description from CIBC's "Spend Categories" column using the REAL fixed vocabulary (Retail and Grocery, Restaurants, Transportation, Hotel and Travel, Home and Office, Health and Education, Professional and Financial Services, Personal and Household Expenses, Entertainment, Foreign Currency Transactions). Getting this list wrong silently skips rows.
- **CIBC chequing:** rewritten — `_walk_chequing()` is the shared core (used by parse + `chequing_report()` verifier). Direction comes from balance reconciliation (prev ± amount == printed balance), NOT column offsets. Continuation lines fold onto the preceding txn. Amounts stored positive; flow encodes direction; category stays 'Banking'. Verify any chequing statement with `chequing_report(path)` — ties parsed inflow/outflow/closing to the summary box.
- **MONEY_TOKEN** has a `(?!\d)` lookahead + an FX_NOTE guard so exchange-rate lines ("35.00 USD @ 1.4329") aren't mistaken for transactions.

## Data provenance
Source of truth = real PDF statements kept in the gitignored repo root `..` (Amex, CIBC Visa, CIBC chequing); the DB is wiped and re-ingested from these. Any older `Start/transactions.csv` is superseded. **The CSV-import button and `/api/upload/csv-import` route were removed** — importing the CSV used period-start dates (PDFs use real per-txn dates → different dedup keys → silent duplicates that doubled every metric). PDFs only. (A dormant inline `csv` branch may remain in `app/api/upload/route.ts` but nothing triggers it.) Rent is a recurring e-transfer; tag it via an in-app category rule on the recipient (keeps the personal handle out of tracked source).

## Recategorization
- `recategorizeAll()` (lib/db/categories.ts) re-applies category_rules (first-match-wins), skipping manual overrides. Card rows: full rules, fallback 'Other / uncategorized'. Chequing rows: **debit purchases (flow=spend)** get any rule (fallback 'Banking'); **transfers (flow=transfer)** get ONLY user-defined categories — seeded card-merchant rules are excluded so a location like "TELUS Garden Banking Ctr" doesn't false-match Phone/utilities; income/payment/fee_interest are never reclassified. This is how rent (a transfer) gets tagged 'Rent / housing' via an in-app rule on the private e-transfer handle (never hardcode the handle in source).

**User rules survive DB wipes.** addRule/deleteRule also persist to `data/user-rules.json` (gitignored), and `seedCategoryRules()` restores them on top of the built-in SEED_RULES whenever a fresh DB is seeded. So after a wipe + re-ingest the rent rule (and any other custom rule) is auto-restored — no manual re-add. The private handle lives only in that gitignored file, never in tracked source. (Built-in rule *deletions* are not persisted — a wipe brings seeded rules back.)
- The CSV import calls it automatically (the seed CSV's categories came from the OLD buggy parser).
- Exposed as POST /api/categories `{action:"recategorize_all"}` and the "RECATEGORIZE ALL" button on /categories.
- **Known limitation:** the seed Start/transactions.csv has CIBC Visa descriptions the old parser
  truncated (e.g. "BREAKING", "BAR", "ALBERNI"). The full merchant name is gone, so ~12 rows stay
  "Other / uncategorized" and can't be rule-matched. Re-uploading the actual CIBC PDFs through the
  fixed parser yields full descriptions and resolves them. Do NOT add short keyword rules to catch
  these — that reintroduces the substring-collision class of bug we just fixed.

## UI components from ChromaDB
InputGroup (lib/components/ui/input-group.tsx) and the Tabs line variant were adapted from chroma-core/chroma sample_apps/movies. Prefer checking that repo for new component patterns. See design-aesthetic memory.
