import { test, before } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import { computeDedupKey } from "../db/transactions";

// deleteStatement removes a whole parsed statement: the statement row, every
// transaction with that statement_id, and each of those rows' overrides and
// splits (none carry ON DELETE CASCADE). Rules, goals, and manual/other-statement
// rows are untouched. This is the fourth delete path that must clear children —
// see splits.test.ts "missed third delete path".
//
// Runs over an in-memory DoBackend (isolated by construction, like
// manual-txns.test.ts) — this is ALSO the hosted DO SQL: the UserDataObject owns
// a SqliteRepo over the same lib/db statements SQL, so proving it here proves the
// hosted path.

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);
let db: Database.Database;

before(async () => {
  db = await backend.open();
  await repo.categories.seed();
});

async function insertStmtRow(statementId: number, source: string, description: string, amount: number, seq: number) {
  await repo.transactions.insert({
    statement_id: statementId,
    source,
    account: "TEST ACCT",
    period: "2026-06",
    txn_date: "2026-06-15",
    description,
    amount,
    category: "Other / uncategorized",
    flow: "spend",
    dedup_key: computeDedupKey(source, "2026-06-15", description, amount, seq),
    account_kind: "card",
  });
  return (
    db.prepare("SELECT id FROM transactions WHERE description = ?").get(description) as { id: number }
  ).id;
}

test("deleteById removes the statement, its transactions, and their overrides + splits", async () => {
  const stmtId = await repo.statements.insert({
    filename: "test-visa.pdf",
    source: "test_visa",
    account: "TEST ACCT",
    period: "2026-06",
    row_count: 2,
  });

  // One row carries an override, the other a split — both children we must clear.
  const overridden = await insertStmtRow(stmtId, "test_visa", "ROW WITH OVERRIDE", 20, 1);
  await repo.categories.addOverride(overridden, "Other / uncategorized", "Groceries");
  const split = await insertStmtRow(stmtId, "test_visa", "ROW WITH SPLIT", 50, 2);
  await repo.splits.set(split, [
    { category: "Groceries", amount: 30 },
    { category: "Household", amount: 20 },
  ]);

  // A manual row (statement_id NULL) that must survive the delete.
  const { id: manualId } = await repo.transactions.insertManual({
    txn_date: "2026-06-16",
    description: "Cash at market",
    amount: 12,
    category: "Groceries",
  });

  const res = await repo.statements.deleteById(stmtId);
  assert.equal(res.deleted, 1);
  assert.equal(res.transactions, 2);

  // Statement + both transactions gone.
  assert.equal(db.prepare("SELECT 1 FROM statements WHERE id = ?").get(stmtId), undefined);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM transactions WHERE statement_id = ?").get(stmtId) as { n: number }).n,
    0
  );
  // Children of those transactions gone.
  assert.equal(
    db.prepare("SELECT 1 FROM category_overrides WHERE transaction_id = ?").get(overridden),
    undefined
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM transaction_splits WHERE transaction_id = ?").get(split) as { n: number }).n,
    0
  );
  // The manual row is untouched.
  assert.ok(db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(manualId));
});

test("deleteById on an unknown id is a no-op", async () => {
  const res = await repo.statements.deleteById(999999);
  assert.equal(res.deleted, 0);
  assert.equal(res.transactions, 0);
});
