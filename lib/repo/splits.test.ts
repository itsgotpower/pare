import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Split transactions: set/get/clear roundtrip, the validation matrix, the
// override↔split mutual exclusion (both directions), the recategorize skip-set,
// the aggregation reconciliation invariant (category slices sum to parents so
// monthly totals never move), slice-aware list filtering / category lists, bulk
// override skip semantics, and manual-row deletion with splits attached.
// In-memory DoBackend for isolation (see subscription-marks.test.ts).

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function spend(
  date: string,
  description: string,
  amount: number,
  category: string,
  over: Partial<NewTransaction> = {}
): NewTransaction {
  seq++;
  return {
    statement_id: null,
    source: "amex",
    account: "card",
    account_kind: "card",
    period: date.slice(0, 7),
    txn_date: date,
    description,
    amount,
    category,
    flow: "spend",
    dedup_key: `test|${seq}`,
    ...over,
  };
}

const byDesc = async (description: string): Promise<number> => {
  const db = await backend.open();
  const row = db
    .prepare("SELECT id FROM transactions WHERE description = ?")
    .get(description) as { id: number } | undefined;
  assert.ok(row, `seed row "${description}" should exist`);
  return row.id;
};

const splitCount = async (id: number): Promise<number> => {
  const db = await backend.open();
  return (
    db
      .prepare("SELECT COUNT(*) c FROM transaction_splits WHERE transaction_id = ?")
      .get(id) as { c: number }
  ).c;
};

const overrideRow = async (id: number) => {
  const db = await backend.open();
  return db
    .prepare(
      "SELECT original_category, new_category FROM category_overrides WHERE transaction_id = ?"
    )
    .get(id) as { original_category: string; new_category: string } | undefined;
};

const baseCategory = async (id: number): Promise<string> => {
  const db = await backend.open();
  return (
    db.prepare("SELECT category FROM transactions WHERE id = ?").get(id) as {
      category: string;
    }
  ).category;
};

before(async () => {
  await backend.open();
  await repo.categories.seed();
  const rows: NewTransaction[] = [
    // The main split target (Groceries by rule and by stored category).
    spend("2026-05-03", "COSTCO WAREHOUSE 123", 120, "Groceries"),
    // Stored base deliberately DISAGREES with the rules (STARBUCKS → Coffee) so
    // the recategorize passes would rewrite it — unless the split skip works.
    spend("2026-05-04", "STARBUCKS CORNER", 30, "Misc"),
    // Override↔split mutual-exclusion target.
    spend("2026-05-05", "LUNCH SPOT", 45, "Restaurants & takeout"),
    // Bulk targets.
    spend("2026-05-06", "BULK ONE", 10, "Other / uncategorized"),
    spend("2026-05-07", "BULK TWO", 20, "Other / uncategorized"),
    // Non-spend flow — splits must be refused.
    spend("2026-05-15", "PAYROLL PEOPLE CENTER", 3000, "Banking", {
      source: "cibc_chequing",
      account: "chq",
      account_kind: "chequing",
      flow: "income",
    }),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);
});

test("set/get/clear roundtrip", async () => {
  const id = await byDesc("COSTCO WAREHOUSE 123");
  await repo.splits.set(id, [
    { category: "Groceries", amount: 70 },
    { category: "Office supplies", amount: 50 },
  ]);

  const parts = await repo.splits.list(id);
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((p) => [p.transaction_id, p.category, p.amount]),
    [
      [id, "Groceries", 70],
      [id, "Office supplies", 50],
    ]
  );

  // Replace, not append: setting again yields the new parts only.
  await repo.splits.set(id, [
    { category: "Groceries", amount: 100 },
    { category: "Office supplies", amount: 20 },
  ]);
  assert.equal((await repo.splits.list(id)).length, 2);
  assert.equal((await repo.splits.list(id))[0].amount, 100);

  await repo.splits.clear(id);
  assert.equal((await repo.splits.list(id)).length, 0);
});

test("validation rejections", async () => {
  const id = await byDesc("COSTCO WAREHOUSE 123");
  const incomeId = await byDesc("PAYROLL PEOPLE CENTER");

  await assert.rejects(
    repo.splits.set(id, [{ category: "Groceries", amount: 120 }]),
    /at least 2 parts/
  );
  await assert.rejects(
    repo.splits.set(id, [
      { category: "Groceries", amount: 70 },
      { category: "Coffee", amount: 40 },
    ]),
    /add up to the transaction amount/
  );
  await assert.rejects(
    repo.splits.set(incomeId, [
      { category: "A", amount: 1500 },
      { category: "B", amount: 1500 },
    ]),
    /Only spend transactions/
  );
  await assert.rejects(
    repo.splits.set(id, [
      { category: "Groceries", amount: 120 },
      { category: "Coffee", amount: 0 },
    ]),
    /greater than zero/
  );
  await assert.rejects(
    repo.splits.set(id, [
      { category: "Groceries", amount: 130 },
      { category: "Coffee", amount: -10 },
    ]),
    /greater than zero/
  );
  await assert.rejects(
    repo.splits.set(id, [
      { category: "Groceries", amount: 70 },
      { category: "   ", amount: 50 },
    ]),
    /needs a category/
  );
  await assert.rejects(
    repo.splits.set(999999, [
      { category: "A", amount: 1 },
      { category: "B", amount: 1 },
    ]),
    /transaction not found/
  );

  // Nothing was written by any rejected call.
  assert.equal(await splitCount(id), 0);
});

test("half-cent tolerance accepts penny-rounded thirds", async () => {
  const id = await byDesc("COSTCO WAREHOUSE 123");
  // 120 into 3 × 40 exactly; also verify 0.005 tolerance with uneven cents.
  await repo.splits.set(id, [
    { category: "Groceries", amount: 40.01 },
    { category: "Coffee", amount: 39.99 },
    { category: "Office supplies", amount: 40.0 },
  ]);
  assert.equal(await splitCount(id), 3);
  await repo.splits.clear(id);
});

test("splits supersede overrides — mutual exclusion both directions", async () => {
  const id = await byDesc("LUNCH SPOT");

  // Direction 1: setting a split deletes an existing override.
  await repo.categories.addOverride(id, "Restaurants & takeout", "Date night");
  assert.ok(await overrideRow(id), "override should exist before the split");
  await repo.splits.set(id, [
    { category: "Restaurants & takeout", amount: 30 },
    { category: "Coffee", amount: 15 },
  ]);
  assert.equal(await overrideRow(id), undefined, "split must clear the override");
  assert.equal(await splitCount(id), 2);

  // Direction 2: adding an override deletes the split.
  await repo.categories.addOverride(id, "Restaurants & takeout", "Date night");
  assert.equal(await splitCount(id), 0, "override must clear the split");
  assert.ok(await overrideRow(id));

  await repo.categories.removeOverride(id);
});

test("recategorizeAll and recategorizeMatching skip split transactions", async () => {
  const id = await byDesc("STARBUCKS CORNER");
  assert.equal(await baseCategory(id), "Misc");
  await repo.splits.set(id, [
    { category: "Coffee", amount: 10 },
    { category: "Groceries", amount: 20 },
  ]);

  await repo.categories.recategorizeMatching("STARBUCKS", "Coffee");
  assert.equal(
    await baseCategory(id),
    "Misc",
    "recategorizeMatching must not rewrite a split row's base category"
  );

  await repo.categories.recategorizeAll();
  assert.equal(
    await baseCategory(id),
    "Misc",
    "recategorizeAll must not rewrite a split row's base category"
  );

  await repo.splits.clear(id);
  // Sanity: once the split is gone the same pass DOES retag it.
  await repo.categories.recategorizeAll();
  assert.equal(await baseCategory(id), "Coffee");
});

test("category breakdown counts split parts; monthly totals unchanged (reconciliation)", async () => {
  const id = await byDesc("COSTCO WAREHOUSE 123");

  const monthlyBefore = (await repo.summary.monthlyTotals()).find((m) => m.month === "2026-05")!;
  await repo.splits.set(id, [
    { category: "Groceries", amount: 70 },
    { category: "Office supplies", amount: 50 },
  ]);
  const monthlyAfter = (await repo.summary.monthlyTotals()).find((m) => m.month === "2026-05")!;
  assert.ok(
    Math.abs(monthlyBefore.total - monthlyAfter.total) < 1e-9,
    "amount-only aggregates keep reading parents — a split must not move the monthly total"
  );

  const breakdown = await repo.summary.categoryBreakdown("2026-05");
  const groceries = breakdown.find((c) => c.category === "Groceries");
  const office = breakdown.find((c) => c.category === "Office supplies");
  assert.equal(groceries?.total, 70, "the parent's $120 contributes only its $70 part");
  assert.equal(office?.total, 50);
  assert.equal(office?.count, 1, "COUNT(DISTINCT transaction_id) — one parent, not N slices");

  // The invariant everything hangs off: slices total exactly what parents do.
  const sliceSum = breakdown.reduce((s, c) => s + c.total, 0);
  assert.ok(Math.abs(sliceSum - monthlyAfter.total) < 1e-9);
});

test("list category filter matches a parent via a split part; has_splits flag set", async () => {
  const id = await byDesc("COSTCO WAREHOUSE 123");
  const { rows } = await repo.transactions.list({ category: "Office supplies" });
  const parent = rows.find((r) => r.id === id);
  assert.ok(parent, "the split parent should match its part's category");
  assert.equal(parent.amount, 120, "the list shows the parent row, whole");
  assert.equal(parent.has_splits, 1);
});

test("getCategories includes a split-only category", async () => {
  const cats = await repo.transactions.categories();
  assert.ok(cats.includes("Office supplies"));
});

test("bulkOverride: updated/skipped semantics, split rows skipped", async () => {
  const one = await byDesc("BULK ONE");
  const two = await byDesc("BULK TWO");
  const split = await byDesc("COSTCO WAREHOUSE 123"); // still split from above

  const res = await repo.categories.bulkOverride([one, two, split, 999999], "Fun money");
  assert.deepEqual(res, { updated: 2, skipped: 2 });

  const o1 = await overrideRow(one);
  assert.equal(o1?.new_category, "Fun money");
  assert.equal(
    o1?.original_category,
    "Other / uncategorized",
    "original_category is the stored base, resolved server-side"
  );
  assert.equal(await overrideRow(split), undefined, "split rows are skipped, not clobbered");
  assert.equal(await splitCount(split), 2, "the split survives a bulk assign");

  // Re-running is an upsert, not a duplicate.
  const again = await repo.categories.bulkOverride([one], "Fun money");
  assert.deepEqual(again, { updated: 1, skipped: 0 });

  await assert.rejects(
    repo.categories.bulkOverride(Array.from({ length: 501 }, (_, i) => i + 1), "X"),
    /max 500/
  );
});

test("deleteManualTransaction removes a split manual row cleanly", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-05-20",
    description: "FARMERS MARKET",
    amount: 40,
    category: "Groceries",
  });
  await repo.splits.set(id, [
    { category: "Groceries", amount: 25 },
    { category: "Coffee", amount: 15 },
  ]);
  assert.equal(await splitCount(id), 2);

  const { deleted } = await repo.transactions.deleteManual(id);
  assert.equal(deleted, 1);
  assert.equal(await splitCount(id), 0, "the FK children are deleted with the row");
});

test("deleteImport removes a split imported row without an FK throw", async () => {
  // Cross-app imports (Monarch/Mint/YNAB) create import_id spend rows the user
  // can split; deleting that import must clear transaction_splits first, same as
  // the WIPE and deleteManual paths. Regression for the missed third delete path.
  const importId = await repo.imports.create({
    provider: "monarch",
    row_count: 1,
    account_map: "{}",
    date_min: "2026-05-01",
    date_max: "2026-05-31",
  });
  await repo.transactions.insertMany([
    spend("2026-05-10", "IMPORTED SPLITTABLE", 80, "Shopping / retail", {
      import_id: importId,
      dedup_key: `imp|${importId}`,
    }),
  ]);
  const txId = await byDesc("IMPORTED SPLITTABLE");
  await repo.splits.set(txId, [
    { category: "Groceries", amount: 50 },
    { category: "Coffee", amount: 30 },
  ]);
  assert.equal(await splitCount(txId), 2);

  const { deleted } = await repo.imports.delete(importId);
  assert.equal(deleted, 1, "the imported row is removed");
  assert.equal(await splitCount(txId), 0, "its splits go with it, no FK violation");
});

test("monthly transaction count is split-immune (parent-level COUNT)", async () => {
  const before = (await repo.summary.monthlyTotals()).reduce((s, m) => s + m.count, 0);
  await repo.transactions.insertMany([
    spend("2026-04-15", "SPLIT ME MONTHLY", 100, "Shopping / retail", {
      dedup_key: "monthly-split|1",
    }),
  ]);
  const afterInsert = (await repo.summary.monthlyTotals()).reduce((s, m) => s + m.count, 0);
  assert.equal(afterInsert, before + 1, "one new transaction adds one to the count");

  const id = await byDesc("SPLIT ME MONTHLY");
  await repo.splits.set(id, [
    { category: "Groceries", amount: 60 },
    { category: "Coffee", amount: 40 },
  ]);
  const afterSplit = (await repo.summary.monthlyTotals()).reduce((s, m) => s + m.count, 0);
  assert.equal(afterSplit, afterInsert, "splitting it across 2 categories still counts as one");
});
