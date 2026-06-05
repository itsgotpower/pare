# Parse

Local-first personal finance app. Parses bank and credit-card PDF statements, categorizes transactions by keyword rules, and shows spending trends with budget goals — all on your machine, no cloud sync or telemetry.

> **Privacy:** All financial data stays local. See [SECURITY.md](SECURITY.md) for the privacy model and pre-publish checklist.

## Features

- **PDF ingestion** — drag-and-drop Amex, CIBC Visa, and CIBC chequing statements; Python parser extracts transactions automatically
- **Smart categorization** — first-match keyword rules with a seed dictionary; add your own rules via the UI and they persist across DB rebuilds
- **Dashboard** — monthly spending bars, category donut, top merchants, budget goal progress, income vs. spend breakdown, net cashflow
- **Transactions** — searchable, filterable table with spend/all views and pagination
- **Budget goals** — set monthly limits per category with progress bars (green / yellow / red)
- **Deduplication** — SHA-256 hash per transaction prevents double-imports

## Stack

- Next.js 15 (App Router, TypeScript)
- SQLite via better-sqlite3
- Recharts
- Tailwind CSS 4 + shadcn/ui (brutalist bento theme)
- Python 3 + pdftotext (poppler) for PDF parsing

## Prerequisites

- Node.js 18+
- Python 3.10+
- poppler (`pdftotext`) — `brew install poppler` on macOS

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Upload a PDF statement on the `/upload` page to get started.

## PDF parser (standalone)

```bash
python3 lib/parser/parse_statements.py <pdf-directory> --json
```

## Project structure

```
app/              Next.js App Router pages + API routes
lib/
  db.ts           SQLite singleton (WAL mode)
  db/             Query layers — categories, income, goals, migrations
  parser/         Python PDF parser (Amex, CIBC Visa, CIBC chequing)
  colors.ts       Earth-tone category colour palette
components/       UI components (shadcn/ui + custom)
data/             Runtime data — DB, user rules (gitignored)
```

## License

MIT
