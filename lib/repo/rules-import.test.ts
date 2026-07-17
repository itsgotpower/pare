import { test, before } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Two related concerns, both exercised over the in-memory DoBackend (the same DO
// SQL-adapter path the hosted per-user store uses, so this covers self-host AND
// hosted):
//
//  1. Deposit-kind recategorization — recategorizeAll must treat savings/
//     investment like chequing (unmatched spend → 'Banking', income never
//     touched), NOT like a card (which falls back to 'Other / uncategorized').
//     Regression guard: the checks used to hardcode account_kind = 'chequing'.
//  2. importRules — bulk upsert of a rules export (added/updated/skipped counts)
//     followed by recategorizeAll tagging the matching rows.

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);
let db: Database.Database;

type RawRow = { id: number; category: string; account_kind: string; flow: string };

function row(overrides: Partial<NewTransaction> & { dedup_key: string }): NewTransaction {
  return {
    statement_id: null,
    source: "test",
    account: "test",
    period: "2026-06",
    txn_date: "2026-06-15",
    description: "MERCHANT",
    amount: 12.5,
    category: "Other / uncategorized",
    flow: "spend",
    account_kind: "unknown",
    ...overrides,
  };
}

const cat = (id: number) =>
  (db.prepare("SELECT category FROM v_transactions WHERE id = ?").get(id) as { category: string })
    .category;

before(async () => {
  db = await backend.open();
  await repo.categories.seed(); // generic STARTER_RULES (no seed-rules.json here)
});

test("recategorizeAll gives savings the deposit contract, not the card catch-all", async () => {
  const { inserted } = await repo.transactions.insertMany([
    // savings SPEND with no matching rule → must land 'Banking', not 'Other'
    row({ dedup_key: "s-nobait", account_kind: "savings", flow: "spend", description: "FISHING BAIT" }),
    // savings SPEND that matches a seed rule → the rule still applies
    row({ dedup_key: "s-safeway", account_kind: "savings", flow: "spend", description: "SAFEWAY #12" }),
    // savings INCOME → never reclassified (stays as inserted)
    row({ dedup_key: "s-pay", account_kind: "savings", flow: "income", description: "PAY DAY", category: "Banking" }),
    // identical unmatched description on a CARD → proves the branch differs
    row({ dedup_key: "c-nobait", account_kind: "card", flow: "spend", description: "FISHING BAIT" }),
  ]);
  assert.equal(inserted, 4);

  const ids = Object.fromEntries(
    (db.prepare("SELECT id, dedup_key FROM transactions").all() as { id: number; dedup_key: string }[]).map(
      (r) => [r.dedup_key, r.id]
    )
  );

  await repo.categories.recategorizeAll();

  assert.equal(cat(ids["s-nobait"]), "Banking", "unmatched savings spend → Banking");
  assert.equal(cat(ids["s-safeway"]), "Groceries", "matched savings spend → the rule");
  assert.equal(cat(ids["s-pay"]), "Banking", "savings income is never reclassified");
  assert.equal(
    cat(ids["c-nobait"]),
    "Other / uncategorized",
    "unmatched CARD spend still uses the card catch-all"
  );
});

test("importRules upserts by keyword and reports added/updated/skipped", async () => {
  const before = new Set(
    (await repo.categories.listRules()).map((r) => r.keyword.toUpperCase())
  );
  assert.ok(before.has("NETFLIX"), "NETFLIX is a seeded keyword (precondition)");

  const result = await repo.categories.importRules([
    { category: "Restaurants & takeout", keyword: "TREES CHEES" }, // new
    { category: "Shopping / retail", keyword: "NETFLIX" }, // remaps an existing keyword
    { category: "Coffee", keyword: "trees chees" }, // dup within payload (last wins)
    { category: "", keyword: "BLANKCAT" }, // skipped (empty category)
    { category: "Groceries", keyword: "   " }, // skipped (blank keyword)
  ]);

  assert.equal(result.added, 1, "one genuinely new keyword");
  assert.equal(result.updated, 1, "NETFLIX already existed → update");
  assert.equal(result.skipped, 2, "blank category + blank keyword dropped");

  const rules = await repo.categories.listRules();
  const trees = rules.filter((r) => r.keyword.toUpperCase() === "TREES CHEES");
  assert.equal(trees.length, 1, "no duplicate keyword rows");
  assert.equal(trees[0].category, "Coffee", "last dup in the payload wins");
  assert.equal(
    rules.find((r) => r.keyword === "NETFLIX")?.category,
    "Shopping / retail",
    "existing keyword remapped"
  );
});

test("imported rules categorize existing rows on the following recategorize", async () => {
  await repo.transactions.insertMany([
    row({ dedup_key: "card-otter", account_kind: "card", flow: "spend", description: "OTTER CO-OP WESTBANK" }),
  ]);
  const id = (db.prepare("SELECT id FROM transactions WHERE dedup_key = 'card-otter'").get() as {
    id: number;
  }).id;

  assert.equal(cat(id), "Other / uncategorized", "uncategorized before its rule exists");

  await repo.categories.importRules([{ category: "Groceries", keyword: "OTTER CO-OP" }]);
  await repo.categories.recategorizeAll();

  assert.equal(cat(id), "Groceries", "the imported rule tags the card row");
});

test("hosted mode never writes the user-rules.json redundancy file", async () => {
  // The JSON file is self-host wipe-survival; hosted rules live in the per-user
  // DO. In hosted mode the persist is skipped outright (a shared server file
  // would also cross user boundaries).
  const fs = await import("node:fs");
  const path = await import("node:path");
  const file = path.join(process.env.PARE_DATA_DIR!, "user-rules.json");
  fs.rmSync(file, { force: true });

  process.env.PARE_DEPLOY_TARGET = "hosted";
  try {
    await repo.categories.addRule("Hosted category", "HOSTED SKIP KEYWORD");
    assert.equal(fs.existsSync(file), false, "no redundancy file in hosted mode");
    const rules = await repo.categories.listRules();
    assert.ok(
      rules.some((r) => r.keyword === "HOSTED SKIP KEYWORD"),
      "the DB row is still the source of truth"
    );
  } finally {
    delete process.env.PARE_DEPLOY_TARGET;
  }
});
