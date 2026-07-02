import { test, before } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import { computeDedupKey, type TransactionRow } from "../db/transactions";

// Manual/cash quick-add: rows with source 'manual' + account_kind 'cash' land in
// the spend universe (SPEND_WHERE), the user's category pick survives
// recategorizeAll via an override, intentional same-day duplicates both insert
// (UUID dedup keys), and only manual rows are deletable.
//
// Runs over an in-memory DoBackend (like do-backend.test.ts) so it is isolated
// by construction — the repo suite shares ONE process, and lib/db.ts fixes its
// file path at first import, so a FileBackend test here could reach the real
// data/pare.db. Raw-row assertions use the backend's own connection.

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);
let db: Database.Database;

// v_transactions carries account_kind (t.*) even though TransactionRow doesn't
// declare it.
type RawRow = TransactionRow & { account_kind: string };

before(async () => {
  db = await backend.open();
  await repo.categories.seed();
});

test("insertManual lands in the spend universe with the picked category", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-06-15",
    description: "Farmers market",
    amount: 42.5,
    category: "Groceries",
  });
  assert.ok(id > 0);

  const row = db.prepare("SELECT * FROM v_transactions WHERE id = ?").get(id) as RawRow;
  assert.equal(row.source, "manual");
  assert.equal(row.account_kind, "cash");
  assert.equal(row.flow, "spend");
  assert.equal(row.period, "2026-06");
  assert.equal(row.statement_id, null);
  // "Farmers market" matches no seeded rule, so the pick is an override over
  // the rules fallback.
  assert.equal(row.category, "Other / uncategorized");
  assert.equal(row.effective_category, "Groceries");

  // Spend charts: monthly totals and the heatmap both count it.
  const totals = await repo.summary.monthlyTotals();
  const june = totals.find((t) => t.month === "2026-06");
  assert.ok(june, "2026-06 missing from monthly totals");
  assert.ok(Math.abs(june.total - 42.5) < 1e-9);

  const daily = await repo.heatmap.dailySpend();
  assert.ok(daily.some((d) => d.date === "2026-06-15"));
});

test("a pick matching the rules engine stores no override", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-06-16",
    description: "STARBUCKS on the corner",
    amount: 6.25,
    category: "Coffee", // seeded STARBUCKS rule says the same
  });
  const override = db
    .prepare("SELECT 1 FROM category_overrides WHERE transaction_id = ?")
    .get(id);
  assert.equal(override, undefined);
});

test("recategorizeAll keeps the explicit pick", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-06-17",
    description: "Cash to friend for PIZZA night",
    amount: 20,
    category: "Gifts", // rules would say Restaurants & takeout (PIZZA)
  });
  await repo.categories.recategorizeAll();
  const row = db
    .prepare("SELECT effective_category FROM v_transactions WHERE id = ?")
    .get(id) as { effective_category: string };
  assert.equal(row.effective_category, "Gifts");
});

test("intentional duplicates both insert", async () => {
  const input = {
    txn_date: "2026-06-18",
    description: "Coffee cart",
    amount: 4,
    category: "Coffee",
  };
  const a = await repo.transactions.insertManual(input);
  const b = await repo.transactions.insertManual(input);
  assert.notEqual(a.id, b.id);
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE description = 'Coffee cart'")
    .get() as { n: number };
  assert.equal(n.n, 2);
});

test("deleteManual removes the row and its override; statement rows are refused", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-06-19",
    description: "Bus fare",
    amount: 3.1,
    category: "Gifts", // forces an override row
  });
  const { deleted } = await repo.transactions.deleteManual(id);
  assert.equal(deleted, 1);
  assert.equal(db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(id), undefined);
  assert.equal(
    db.prepare("SELECT 1 FROM category_overrides WHERE transaction_id = ?").get(id),
    undefined
  );

  // A parsed-style (statement-backed) row must be refused.
  await repo.transactions.insert({
    statement_id: null,
    source: "amex",
    account: "XXXX",
    period: "2026-06",
    txn_date: "2026-06-19",
    description: "SYNTHETIC CARD CHARGE",
    amount: 10,
    category: "Other / uncategorized",
    flow: "spend",
    dedup_key: computeDedupKey("amex", "2026-06-19", "SYNTHETIC CARD CHARGE", 10, 1),
    account_kind: "card",
  });
  const parsed = db
    .prepare("SELECT id FROM transactions WHERE description = 'SYNTHETIC CARD CHARGE'")
    .get() as { id: number };
  const refused = await repo.transactions.deleteManual(parsed.id);
  assert.equal(refused.deleted, 0);
  assert.ok(db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(parsed.id));
});
