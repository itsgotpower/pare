/**
 * Unit tests for the shared MCP tool registry (mcp/tools.ts) against a FAKE
 * repo — proves the registry is transport- and backend-agnostic, which is the
 * contract the hosted /api/mcp route relies on (it injects a per-user DO repo
 * where these tests inject canned data). Runs in the test:repo suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { registerPareTools, type RegisterPareToolsOptions } from "./tools";
import type { Repo } from "../lib/repo";

// Minimal fake covering exactly the namespaces the tested tools touch. Calls
// are recorded so tests can assert routing; everything else is absent — a tool
// reaching outside its declared surface fails loudly.
function makeFakeRepo() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const repo = {
    summary: {
      monthlyTotals: async (...a: unknown[]) => (record("monthlyTotals", a), [{ month: "2026-06", total: 1234 }]),
      categoryBreakdown: async (...a: unknown[]) => (record("categoryBreakdown", a), [{ category: "Groceries", total: 400 }]),
      topMerchants: async (...a: unknown[]) => (record("topMerchants", a), [{ merchant: "MARKET", total: 120 }]),
    },
    goals: {
      upsert: async (...a: unknown[]) => record("upsert", a),
      list: async () => [{ id: 7, category: "Dining out", monthly_limit: 200 }],
      delete: async (...a: unknown[]) => record("deleteGoal", a),
      currentProgress: async () => [{ category: "Dining out", spent: 50, limit: 200 }],
    },
    transactions: {
      categoryOf: async (id: number) => (id === 42 ? { category: "Other / uncategorized" } : null),
    },
    categories: {
      addOverride: async (...a: unknown[]) => record("addOverride", a),
    },
  };
  return { repo: repo as unknown as Repo, calls };
}

async function connect(repo: Repo, options?: RegisterPareToolsOptions) {
  const server = new McpServer({ name: "pare-test", version: "0.0.0" });
  registerPareTools(server, repo, options);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

const READ_TOOLS = [
  "spending_summary", "list_transactions", "category_breakdown", "income_summary",
  "cashflow", "baseline", "subscriptions", "goals_status", "insights", "list_categories",
];
const WRITE_TOOLS = [
  "set_goal", "delete_goal", "add_category_rule", "delete_category_rule",
  "recategorize_all", "tag_transaction", "add_manual_transaction", "delete_manual_transaction",
];

test("registry exposes all 18 tools by default", async () => {
  const { repo } = makeFakeRepo();
  const client = await connect(repo);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...READ_TOOLS, ...WRITE_TOOLS].sort());
  await client.close();
});

test("writeTools: false registers only the read tools", async () => {
  const { repo } = makeFakeRepo();
  const client = await connect(repo, { writeTools: false });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...READ_TOOLS].sort());
  await client.close();
});

test("spending_summary routes through the injected repo with defaults", async () => {
  const { repo, calls } = makeFakeRepo();
  const client = await connect(repo);
  const res = (await client.callTool({ name: "spending_summary", arguments: {} })) as {
    content: Array<{ type: string; text: string }>;
  };
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.monthly_totals[0].total, 1234);
  assert.equal(payload.category_breakdown[0].category, "Groceries");
  // months defaults to 12; top merchants asks for 10.
  assert.deepEqual(calls.monthlyTotals[0], [12]);
  assert.deepEqual(calls.topMerchants[0], [10, undefined]);
  await client.close();
});

test("set_goal writes through the injected repo", async () => {
  const { repo, calls } = makeFakeRepo();
  const client = await connect(repo);
  const res = (await client.callTool({
    name: "set_goal",
    arguments: { category: "Dining out", monthly_limit: 250 },
  })) as { content: Array<{ text: string }> };
  assert.equal(JSON.parse(res.content[0].text).ok, true);
  assert.deepEqual(calls.upsert[0], ["Dining out", 250]);
  await client.close();
});

test("tag_transaction refuses an unknown transaction id", async () => {
  const { repo, calls } = makeFakeRepo();
  const client = await connect(repo);
  const res = (await client.callTool({
    name: "tag_transaction",
    arguments: { transaction_id: 999, category: "Rent / housing" },
  })) as { content: Array<{ text: string }> };
  assert.equal(JSON.parse(res.content[0].text).ok, false);
  assert.equal(calls.addOverride, undefined);
  await client.close();
});
