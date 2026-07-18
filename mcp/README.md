# Pare — Finance MCP Server

A local [MCP](https://modelcontextprotocol.io) server that exposes your Pare
finance data (the local `data/pare.db`) as tools, so an MCP client like Claude
can query and lightly manage your spending — **entirely on your machine**.

It reuses the app's `lib/db` query layer (no duplicated SQL) and talks **stdio**.

## Tools

**Read**
- `spending_summary` — monthly totals + category breakdown + top merchants
- `list_transactions` — filter by category / source / flow / date range / search
- `category_breakdown` — spend per category (optionally one month)
- `income_summary` — income by type + income-vs-spend series
- `cashflow` — net cashflow per month + period surplus
- `baseline` — discretionary baseline (large one-offs removed)
- `subscriptions` — detected recurring charges + double-bill flags
- `goals_status` — goal progress for the latest data month
- `insights` — auto tips (over-budget, MoM moves, surplus/deficit, one-offs)
- `list_categories` — categories in use + keyword rules
- `list_statements` — uploaded/synced statements with ids, periods, closing balances

**Write**
- `set_goal` / `delete_goal` — manage a category's monthly limit
- `add_category_rule` / `delete_category_rule` — manage keyword→category rules (persist across DB wipes)
- `recategorize_all` — re-apply rules to all transactions
- `tag_transaction` — override one transaction's category by id
- `add_manual_transaction` — record a cash / off-statement purchase (date, description, amount, category)
- `delete_manual_transaction` — delete a manually recorded transaction by id (statement rows refused)
- `delete_statement` — delete a statement and every transaction parsed from it, by id (find via `list_statements`)

## Run

```bash
# from the repo root (parse/)
PARE_DB_PATH="$(pwd)/data/pare.db" npm run mcp
```

`PARE_DB_PATH` is optional when launched from the repo root (defaults to
`<cwd>/data/pare.db`), but an MCP client launches the server with an unknown
working directory, so set it to an **absolute path** in the client config.

Smoke test: `npx tsx mcp/test-client.ts`

## Register with Claude Code

Registered at **user scope** in `~/.claude.json` under `mcpServers` (restart Claude
Code to load it):

```json
{
  "mcpServers": {
    "pare-finance": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": [
        "/abs/parse/node_modules/tsx/dist/cli.mjs",
        "/abs/parse/mcp/server.ts"
      ],
      "cwd": "/abs/parse",
      "env": { "PARE_DB_PATH": "/abs/parse/data/pare.db" }
    }
  }
}
```

`cwd` must be the repo root — `lib/db/migrate.ts` resolves migrations via
`process.cwd()` (same as the Next app). Equivalent shorthand if `tsx`/`npx` are on
PATH: `command: "npx", args: ["tsx", "mcp/server.ts"]` with the same `cwd` + `env`.

Then ask things like *"How much did I spend on restaurants last month?"*,
*"What subscriptions am I paying for?"*, *"Set a $400 restaurant budget."*, or
*"I spent $40 cash at the market."*

## Privacy

The server reads/writes only the local SQLite DB. No network calls. The DB and
all statements stay gitignored — never commit `data/`.
