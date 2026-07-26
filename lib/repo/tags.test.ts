import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import { computeDedupKey } from "../db/transactions";
import type { NewTransaction } from "./types";

// Tags + reimbursement tracking (lib/db/tags.ts, migration 013): set/replace/
// clear roundtrip, normalization (lowercase-trim-dedupe), unknown-id rejection,
// the tag filter on transactions.list(), the reimbursement lifecycle
// (mark → outstanding summary → reimbursed → clear), hidden-account handling
// (display reads exclude, export reads include), and child cleanup on ALL
// transaction-delete paths (deleteStatement / deleteManual / deleteImport) —
// tags and reimbursements FK transactions(id) with no ON DELETE CASCADE, so a
// missed site is a production FK throw. In-memory DoBackend for isolation
// (see splits.test.ts).

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

const tagCount = async (id: number): Promise<number> => {
  const db = await backend.open();
  return (
    db
      .prepare("SELECT COUNT(*) c FROM transaction_tags WHERE transaction_id = ?")
      .get(id) as { c: number }
  ).c;
};

const reimbRow = async (id: number) => {
  const db = await backend.open();
  return db
    .prepare("SELECT status, marked_at, reimbursed_at FROM reimbursements WHERE transaction_id = ?")
    .get(id) as { status: string; marked_at: string; reimbursed_at: string | null } | undefined;
};

before(async () => {
  await backend.open();
  await repo.categories.seed();
  const rows: NewTransaction[] = [
    spend("2026-05-03", "CONFERENCE HOTEL", 400, "Travel"),
    spend("2026-05-04", "TEAM LUNCH SPOT", 90, "Restaurants & takeout"),
    spend("2026-05-05", "AIRPORT TAXI", 55, "Transport"),
    // Hidden-account target (source hidden below) — display reads must skip it,
    // export reads must keep it.
    spend("2026-05-06", "HIDDEN CARD CHARGE", 25, "Groceries", {
      source: "old_visa",
      dedup_key: "hidden|1",
    }),
    // Non-spend flow — markReimbursable must refuse it; tags still allowed.
    spend("2026-05-15", "PAYROLL PEOPLE CENTER", 3000, "Banking", {
      source: "cibc_chequing",
      account: "chq",
      account_kind: "chequing",
      flow: "income",
    }),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);
  await repo.accounts.setMeta("old_visa", { hidden: true });
});

test("set/get/replace/clear roundtrip with normalization", async () => {
  const id = await byDesc("CONFERENCE HOTEL");

  // Mixed case, whitespace, duplicates, and empties all normalize away.
  const stored = await repo.tags.set(id, ["  Work-Reimbursable ", "VACATION", "vacation", "", "  "]);
  assert.deepEqual(stored, ["vacation", "work-reimbursable"]);
  assert.deepEqual(await repo.tags.list(id), ["vacation", "work-reimbursable"]);

  // Replace, not append.
  assert.deepEqual(await repo.tags.set(id, ["work"]), ["work"]);
  assert.deepEqual(await repo.tags.list(id), ["work"]);

  // Empty list clears.
  assert.deepEqual(await repo.tags.set(id, []), []);
  assert.deepEqual(await repo.tags.list(id), []);
  assert.equal(await tagCount(id), 0);
});

test("tags are allowed on any flow (orthogonal to categories)", async () => {
  const incomeId = await byDesc("PAYROLL PEOPLE CENTER");
  assert.deepEqual(await repo.tags.set(incomeId, ["bonus"]), ["bonus"]);
  await repo.tags.set(incomeId, []);
});

test("validation rejections", async () => {
  const id = await byDesc("CONFERENCE HOTEL");

  await assert.rejects(repo.tags.set(999999, ["x"]), /transaction not found/);
  await assert.rejects(
    repo.tags.set(id, [123 as unknown as string]),
    /must be a string/
  );
  await assert.rejects(repo.tags.set(id, ["x".repeat(41)]), /capped at 40 characters/);
  await assert.rejects(
    repo.tags.set(id, Array.from({ length: 21 }, (_, i) => `tag-${i}`)),
    /at most 20 tags/
  );
  await assert.rejects(repo.tags.markReimbursable(999999), /transaction not found/);
  await assert.rejects(repo.tags.markReimbursed(999999), /transaction not found/);

  // Nothing was written by any rejected call.
  assert.equal(await tagCount(id), 0);
});

test("counts() excludes hidden accounts; listAll() reads the base table", async () => {
  const visible = await byDesc("CONFERENCE HOTEL");
  const hidden = await byDesc("HIDDEN CARD CHARGE");
  await repo.tags.set(visible, ["vacation"]);
  await repo.tags.set(hidden, ["vacation", "hidden-only"]);

  const counts = await repo.tags.counts();
  assert.deepEqual(
    counts,
    [{ tag: "vacation", count: 1 }],
    "hidden-account rows are excluded from the dropdown counts (view-level rule)"
  );

  const all = await repo.tags.listAll();
  assert.deepEqual(
    all,
    [
      { transaction_id: visible, tag: "vacation" },
      { transaction_id: hidden, tag: "hidden-only" },
      { transaction_id: hidden, tag: "vacation" },
    ],
    "the export read includes hidden accounts and is stably ordered"
  );

  await repo.tags.set(visible, []);
  await repo.tags.set(hidden, []);
});

test("transactions.list tag filter + tags/reimbursement_status row columns", async () => {
  const hotel = await byDesc("CONFERENCE HOTEL");
  const lunch = await byDesc("TEAM LUNCH SPOT");
  await repo.tags.set(hotel, ["work", "conference"]);
  await repo.tags.set(lunch, ["work"]);

  const work = await repo.transactions.list({ tag: "work" });
  assert.equal(work.total, 2);
  assert.deepEqual(
    work.rows.map((r) => r.id).sort((a, b) => a - b),
    [hotel, lunch].sort((a, b) => a - b)
  );

  const conf = await repo.transactions.list({ tag: "conference" });
  assert.equal(conf.total, 1);
  assert.equal(conf.rows[0].id, hotel);
  assert.equal(conf.rows[0].tags, "conference,work", "alphabetical csv aggregate");
  assert.equal(conf.rows[0].reimbursement_status, null);

  // Composes with other filters.
  const none = await repo.transactions.list({ tag: "work", category: "Groceries" });
  assert.equal(none.total, 0);

  await repo.tags.set(hotel, []);
  await repo.tags.set(lunch, []);
});

test("reimbursement lifecycle: mark → outstanding → reimbursed → clear", async () => {
  const hotel = await byDesc("CONFERENCE HOTEL");
  const taxi = await byDesc("AIRPORT TAXI");
  const incomeId = await byDesc("PAYROLL PEOPLE CENTER");

  // Only spend rows can be marked.
  await assert.rejects(
    repo.tags.markReimbursable(incomeId),
    /Only spend transactions/
  );
  // Reimbursed without a mark is refused.
  await assert.rejects(
    repo.tags.markReimbursed(hotel),
    /not marked as reimbursable/
  );

  await repo.tags.markReimbursable(hotel);
  await repo.tags.markReimbursable(taxi);

  let summary = await repo.tags.reimbursementSummary();
  assert.deepEqual(summary, {
    outstanding: { count: 2, total: 455 },
    reimbursed: { count: 0, total: 0 },
  });

  // Row column reflects it.
  const { rows } = await repo.transactions.list({ search: "CONFERENCE" });
  assert.equal(rows[0].reimbursement_status, "outstanding");

  // Re-marking an outstanding row is a no-op, not an error.
  await repo.tags.markReimbursable(hotel);
  assert.equal((await repo.tags.reimbursementSummary()).outstanding.count, 2);

  await repo.tags.markReimbursed(hotel);
  summary = await repo.tags.reimbursementSummary();
  assert.deepEqual(summary, {
    outstanding: { count: 1, total: 55 },
    reimbursed: { count: 1, total: 400 },
  });
  const closed = await reimbRow(hotel);
  assert.equal(closed?.status, "reimbursed");
  assert.ok(closed?.reimbursed_at, "reimbursed_at is stamped");

  // The tracking list: outstanding first, joined with txn fields.
  const listed = await repo.tags.listReimbursements();
  assert.deepEqual(
    listed.map((r) => [r.transaction_id, r.status, r.description, r.amount]),
    [
      [taxi, "outstanding", "AIRPORT TAXI", 55],
      [hotel, "reimbursed", "CONFERENCE HOTEL", 400],
    ]
  );

  // Re-marking a reimbursed row reopens it (upsert clears reimbursed_at).
  await repo.tags.markReimbursable(hotel);
  const reopened = await reimbRow(hotel);
  assert.equal(reopened?.status, "outstanding");
  assert.equal(reopened?.reimbursed_at, null);

  // The export read includes every row, base table.
  const exported = await repo.tags.listAllReimbursements();
  assert.equal(exported.length, 2);
  assert.ok(exported.every((r) => r.status === "outstanding"));

  // Clear is idempotent and removes the mark entirely.
  await repo.tags.clearReimbursement(hotel);
  await repo.tags.clearReimbursement(hotel);
  await repo.tags.clearReimbursement(taxi);
  assert.equal(await reimbRow(hotel), undefined);
  assert.deepEqual(await repo.tags.reimbursementSummary(), {
    outstanding: { count: 0, total: 0 },
    reimbursed: { count: 0, total: 0 },
  });
});

test("reimbursementSummary excludes hidden accounts (view-level rule)", async () => {
  const hidden = await byDesc("HIDDEN CARD CHARGE");
  await repo.tags.markReimbursable(hidden);

  assert.equal(
    (await repo.tags.reimbursementSummary()).outstanding.count,
    0,
    "a hidden account's marks don't surface in the strip"
  );
  assert.equal(
    (await repo.tags.listAllReimbursements()).length,
    1,
    "but the export still carries the row"
  );
  await repo.tags.clearReimbursement(hidden);
});

test("deleteStatement clears tags + reimbursements with the statement's rows", async () => {
  const stmtId = await repo.statements.insert({
    filename: "tags-test-visa.pdf",
    source: "test_visa",
    account: "TEST ACCT",
    period: "2026-06",
    row_count: 1,
  });
  await repo.transactions.insert({
    statement_id: stmtId,
    source: "test_visa",
    account: "TEST ACCT",
    account_kind: "card",
    period: "2026-06",
    txn_date: "2026-06-15",
    description: "STATEMENT ROW WITH TAGS",
    amount: 75,
    category: "Other / uncategorized",
    flow: "spend",
    dedup_key: computeDedupKey("test_visa", "2026-06-15", "STATEMENT ROW WITH TAGS", 75, 1),
  });
  const id = await byDesc("STATEMENT ROW WITH TAGS");
  await repo.tags.set(id, ["work-reimbursable"]);
  await repo.tags.markReimbursable(id);
  assert.equal(await tagCount(id), 1);
  assert.ok(await reimbRow(id));

  const res = await repo.statements.deleteById(stmtId);
  assert.equal(res.deleted, 1);
  assert.equal(res.transactions, 1);
  assert.equal(await tagCount(id), 0, "tags go with the statement's rows — no FK throw");
  assert.equal(await reimbRow(id), undefined, "reimbursement mark goes too");
});

test("deleteManual clears a tagged+marked manual row cleanly", async () => {
  const { id } = await repo.transactions.insertManual({
    txn_date: "2026-05-20",
    description: "CASH TEAM COFFEE",
    amount: 18,
    category: "Coffee",
  });
  await repo.tags.set(id, ["work", "coffee-run"]);
  await repo.tags.markReimbursable(id);

  const { deleted } = await repo.transactions.deleteManual(id);
  assert.equal(deleted, 1);
  assert.equal(await tagCount(id), 0);
  assert.equal(await reimbRow(id), undefined);
});

test("deleteImport clears tags + reimbursements (and overrides) on imported rows", async () => {
  const importId = await repo.imports.create({
    provider: "monarch",
    row_count: 1,
    account_map: "{}",
    date_min: "2026-05-01",
    date_max: "2026-05-31",
  });
  await repo.transactions.insertMany([
    spend("2026-05-10", "IMPORTED TAGGABLE", 80, "Shopping / retail", {
      import_id: importId,
      dedup_key: `imp-tags|${importId}`,
    }),
  ]);
  const id = await byDesc("IMPORTED TAGGABLE");
  await repo.tags.set(id, ["vacation"]);
  await repo.tags.markReimbursable(id);
  // Regression for the pre-existing missed site: an overridden imported row
  // used to make the import undo throw on the transactions FK.
  await repo.categories.addOverride(id, "Shopping / retail", "Travel");

  const { deleted } = await repo.imports.delete(importId);
  assert.equal(deleted, 1, "the imported row is removed");
  assert.equal(await tagCount(id), 0, "its tags go with it, no FK violation");
  assert.equal(await reimbRow(id), undefined);
});
