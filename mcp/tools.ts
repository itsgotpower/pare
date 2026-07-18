/**
 * Pare MCP tool registry — transport-agnostic.
 *
 * The single source of truth for every Pare MCP tool, shared by BOTH servers:
 *   - mcp/server.ts        (self-host: stdio, module-level getRepo())
 *   - app/api/mcp/route.ts (hosted: Streamable HTTP, per-request
 *                           getRepoForUser(session.userId))
 *
 * Everything goes through the async Repo interface — no SQL here, no
 * better-sqlite3 import, so the registry runs identically on Node and workerd.
 * Keep this module free of transport/auth concerns; those belong to the two
 * entry points. Spec: internal/remote-mcp-spec.md.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Repo } from "../lib/repo";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export interface RegisterPareToolsOptions {
  /**
   * Register the mutating tools (set_goal, add_category_rule, tag_transaction,
   * add/delete_manual_transaction, …). Defaults to true — both current entry
   * points expose them (Claude's per-tool-call approval is the write-guard).
   * Exists so a future read-only OAuth scope is a one-line gate, per the spec.
   */
  writeTools?: boolean;
}

export function registerPareTools(
  server: McpServer,
  repo: Repo,
  options: RegisterPareToolsOptions = {}
): void {
  const { writeTools = true } = options;

  // ---- Read tools -----------------------------------------------------------

  server.registerTool(
    "spending_summary",
    {
      title: "Spending summary",
      description: "Monthly card-spend totals plus the category breakdown and top merchants. Use this first for an overview of where money goes.",
      inputSchema: { months: z.number().int().positive().optional(), month: z.string().optional() },
    },
    async ({ months, month }) => json({
      monthly_totals: await repo.summary.monthlyTotals(months ?? 12),
      category_breakdown: await repo.summary.categoryBreakdown(month),
      top_merchants: await repo.summary.topMerchants(10, month),
    })
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Filtered, paginated transactions. Filter by category, source (amex/cibc_visa/cibc_chequing), flow (spend/income/payment/transfer/fee_interest), date range (YYYY-MM-DD), or a free-text description search.",
      inputSchema: {
        category: z.string().optional(),
        source: z.string().optional(),
        flow: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        search: z.string().optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => json(await repo.transactions.list(args))
  );

  server.registerTool(
    "category_breakdown",
    {
      title: "Category breakdown",
      description: "Total card spend per category, optionally for a single month (YYYY-MM).",
      inputSchema: { month: z.string().optional() },
    },
    async ({ month }) => json(await repo.summary.categoryBreakdown(month))
  );

  server.registerTool(
    "income_summary",
    {
      title: "Income summary",
      description: "Income by type (payroll, tax refund, etc.) and the monthly income vs fixed/variable spend series.",
      inputSchema: {},
    },
    async () => json({ income_by_type: await repo.income.byType(), income_vs_spend: await repo.income.vsSpend() })
  );

  server.registerTool(
    "cashflow",
    {
      title: "Net cashflow",
      description: "Net cashflow per month (income − fixed − variable) for months with chequing data, plus the period surplus.",
      inputSchema: {},
    },
    async () => {
      const rows = (await repo.income.vsSpend()).filter((m) => m.income > 0);
      const net = rows.map((m) => ({ month: m.month, income: m.income, fixed: m.fixed, variable: m.variable, net: m.income - m.fixed - m.variable }));
      return json({ monthly: net, period_surplus: net.reduce((s, m) => s + m.net, 0) });
    }
  );

  server.registerTool(
    "baseline",
    {
      title: "Discretionary baseline",
      description: "Spending with large one-off charges (>= threshold) removed — the runway-planning number. Returns per-month total vs baseline and the excluded one-offs.",
      inputSchema: { threshold: z.number().positive().optional() },
    },
    async ({ threshold }) => json(await repo.baseline.get(threshold ?? 300))
  );

  server.registerTool(
    "subscriptions",
    {
      title: "Recurring / subscriptions",
      description: "Detected recurring charges (3+ months) with monthly/annual cost, frequency, and double-bill flags.",
      inputSchema: {},
    },
    async () => json(await repo.subscriptions.get())
  );

  server.registerTool(
    "goals_status",
    {
      title: "Goals status",
      description: "Current spending goals and progress for the latest data month (spent vs limit, % used).",
      inputSchema: {},
    },
    async () => json(await repo.goals.currentProgress())
  );

  server.registerTool(
    "insights",
    {
      title: "Insights",
      description: "Auto-generated tips: over/near-budget goals, month-over-month category moves, net surplus/deficit, large one-offs.",
      inputSchema: {},
    },
    async () => json(await repo.insights.get())
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories & rules",
      description: "Distinct spend categories in use, plus the keyword rules that drive categorization.",
      inputSchema: {},
    },
    async () => json({ categories: await repo.transactions.categories(), rules: await repo.categories.listRules() })
  );

  server.registerTool(
    "list_statements",
    {
      title: "List statements",
      description: "Every uploaded/synced statement with its id, source, account, period, row count, and closing balance. Use the id with delete_statement to remove a mis-parsed statement.",
      inputSchema: {},
    },
    async () => json(await repo.statements.list())
  );

  if (!writeTools) return;

  // ---- Write tools ----------------------------------------------------------

  server.registerTool(
    "set_goal",
    {
      title: "Set spending goal",
      description: "Create or update a monthly spending limit for a category (in CAD dollars).",
      inputSchema: { category: z.string(), monthly_limit: z.number().positive() },
    },
    async ({ category, monthly_limit }) => {
      await repo.goals.upsert(category, monthly_limit);
      return json({ ok: true, goals: await repo.goals.currentProgress() });
    }
  );

  server.registerTool(
    "delete_goal",
    {
      title: "Delete spending goal",
      description: "Remove the spending goal for a category.",
      inputSchema: { category: z.string() },
    },
    async ({ category }) => {
      const g = (await repo.goals.list()).find((x) => x.category === category);
      if (!g) return json({ ok: false, error: `No goal for "${category}"` });
      await repo.goals.delete(g.id);
      return json({ ok: true });
    }
  );

  server.registerTool(
    "add_category_rule",
    {
      title: "Add category rule",
      description: "Add a keyword→category rule (first-match-wins, case-insensitive substring). Set apply_existing to recategorize matching transactions now. Persists across DB wipes.",
      inputSchema: { category: z.string(), keyword: z.string(), apply_existing: z.boolean().optional() },
    },
    async ({ category, keyword, apply_existing }) => {
      await repo.categories.addRule(category, keyword);
      let changed = 0;
      if (apply_existing) changed = await repo.categories.recategorizeAll();
      return json({ ok: true, recategorized: changed });
    }
  );

  server.registerTool(
    "delete_category_rule",
    {
      title: "Delete category rule",
      description: "Delete a category rule by its id (see list_categories).",
      inputSchema: { id: z.number().int() },
    },
    async ({ id }) => {
      await repo.categories.deleteRule(id);
      return json({ ok: true });
    }
  );

  server.registerTool(
    "recategorize_all",
    {
      title: "Recategorize all",
      description: "Re-apply all category rules to every transaction (respecting manual overrides). Returns how many changed.",
      inputSchema: {},
    },
    async () => json({ ok: true, changed: await repo.categories.recategorizeAll() })
  );

  server.registerTool(
    "tag_transaction",
    {
      title: "Recategorize one transaction",
      description: "Override a single transaction's category by id (e.g. tag a specific chequing transfer as 'Rent / housing').",
      inputSchema: { transaction_id: z.number().int(), category: z.string() },
    },
    async ({ transaction_id, category }) => {
      const row = await repo.transactions.categoryOf(transaction_id);
      if (!row) return json({ ok: false, error: `No transaction ${transaction_id}` });
      await repo.categories.addOverride(transaction_id, row.category, category);
      return json({ ok: true });
    }
  );

  server.registerTool(
    "add_manual_transaction",
    {
      title: "Add manual transaction",
      description: "Record a cash or other off-statement purchase (e.g. \"$40 cash at the market\"). Amount is CAD dollars spent (positive); the category is your explicit pick and survives recategorization. Shows up in spend charts under the 'manual' source.",
      inputSchema: {
        txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
        description: z.string().min(1),
        amount: z.number().positive(),
        category: z.string().min(1),
      },
    },
    async ({ txn_date, description, amount, category }) => {
      const { id } = await repo.transactions.insertManual({ txn_date, description, amount, category });
      return json({ ok: true, id });
    }
  );

  server.registerTool(
    "delete_manual_transaction",
    {
      title: "Delete manual transaction",
      description: "Delete a manually recorded transaction by id (find it via list_transactions with source 'manual'). Statement-backed rows are refused.",
      inputSchema: { transaction_id: z.number().int() },
    },
    async ({ transaction_id }) => {
      const { deleted } = await repo.transactions.deleteManual(transaction_id);
      if (!deleted) return json({ ok: false, error: `No manual transaction ${transaction_id}` });
      return json({ ok: true });
    }
  );

  server.registerTool(
    "delete_statement",
    {
      title: "Delete statement",
      description: "Delete a statement AND every transaction parsed from it (plus their overrides and splits), by id (find it via list_statements). Use to remove a mis-parsed statement; rules, goals, and manual/imported rows are untouched. This cannot be undone.",
      inputSchema: { statement_id: z.number().int() },
    },
    async ({ statement_id }) => {
      const { deleted, transactions } = await repo.statements.deleteById(statement_id);
      if (!deleted) return json({ ok: false, error: `No statement ${statement_id}` });
      return json({ ok: true, transactions_removed: transactions });
    }
  );
}
