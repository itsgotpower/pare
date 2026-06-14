/**
 * Smoke test for the Pare MCP server: spawns it over stdio against a THROWAWAY,
 * synthetically-seeded temp DB — NEVER the real data/pare.db — lists tools, and
 * calls read tools plus the write tools (set_goal/delete_goal) so the write path
 * is exercised without touching real financial data. Run: npx tsx mcp/test-client.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { runMigrations } from "../lib/db/migrate";
import { computeDedupKey } from "../lib/db/transactions";

// Disposable DB under the OS temp dir; the server is pointed here via PARE_DB_PATH.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "parse-mcp-test-"));
const dbPath = path.join(tmpDir, "parse-test.db");

// Synthetic, non-personal fixtures (card spend across two months + payroll) so
// the read tools return meaningful output instead of empty arrays.
function seedSyntheticDb(file: string) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key)
    VALUES (@statement_id, @source, @account, @period, @txn_date, @description, @amount, @category, @flow, @dedup_key)
  `);

  const rows = [
    { source: "amex", account: "Amex", period: "2026-04", txn_date: "2026-04-03", description: "STARBUCKS #123", amount: 6.45, category: "Coffee", flow: "spend" },
    { source: "amex", account: "Amex", period: "2026-04", txn_date: "2026-04-10", description: "SAFEWAY #4001", amount: 84.2, category: "Groceries", flow: "spend" },
    { source: "cibc_visa", account: "Visa", period: "2026-04", txn_date: "2026-04-15", description: "SHELL OIL", amount: 52.1, category: "Transport / gas / parking", flow: "spend" },
    { source: "amex", account: "Amex", period: "2026-05", txn_date: "2026-05-02", description: "STARBUCKS #123", amount: 7.1, category: "Coffee", flow: "spend" },
    { source: "amex", account: "Amex", period: "2026-05", txn_date: "2026-05-12", description: "SAFEWAY #4001", amount: 91.5, category: "Groceries", flow: "spend" },
    { source: "cibc_visa", account: "Visa", period: "2026-05", txn_date: "2026-05-20", description: "NETFLIX.COM", amount: 20.99, category: "Subscriptions", flow: "spend" },
    { source: "cibc_chequing", account: "Chequing", period: "2026-04", txn_date: "2026-04-30", description: "PEOPLE CENTER PAYROLL", amount: 3200, category: "Banking", flow: "income" },
    { source: "cibc_chequing", account: "Chequing", period: "2026-05", txn_date: "2026-05-30", description: "PEOPLE CENTER PAYROLL", amount: 3200, category: "Banking", flow: "income" },
  ];

  const seq = new Map<string, number>();
  const tx = db.transaction(() => {
    for (const r of rows) {
      const k = `${r.source}|${r.txn_date}|${r.description}|${r.amount}`;
      const n = (seq.get(k) || 0) + 1;
      seq.set(k, n);
      insert.run({
        ...r,
        statement_id: null,
        dedup_key: computeDedupKey(r.source, r.txn_date, r.description, r.amount, n),
      });
    }
  });
  tx();
  db.close();
}

async function main() {
  seedSyntheticDb(dbPath);

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts"],
    env: { ...process.env, PARE_DB_PATH: dbPath } as Record<string, string>,
  });

  const client = new Client({ name: "parse-test", version: "0.0.1" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`TOOLS (${tools.tools.length}):`, tools.tools.map((t) => t.name).join(", "));

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[])
      .map((c) => c.text ?? "")
      .join("");
    const oneLine = text.replace(/\s+/g, " ").slice(0, 160);
    console.log(`\n# ${name}(${JSON.stringify(args)})\n${oneLine}${text.length > 160 ? " …" : ""}`);
  }

  await call("spending_summary", { months: 3 });
  await call("cashflow");
  await call("subscriptions");
  await call("insights");
  await call("goals_status");
  await call("set_goal", { category: "Coffee", monthly_limit: 60 });
  await call("goals_status");
  await call("delete_goal", { category: "Coffee" });

  await client.close();
  console.log("\nOK (throwaway DB:", dbPath, ")");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Always remove the throwaway DB + its -wal/-shm sidecars.
    rmSync(tmpDir, { recursive: true, force: true });
  });
