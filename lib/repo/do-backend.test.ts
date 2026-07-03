import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore, runMigrationsFromStrings } from "./do-backend";

// ---------------------------------------------------------------------------
// DoBackend + SqliteRepo over an in-memory DurableStore (Node).
//
// better-sqlite3 is a native module, so the DbBackend contract is exercised in
// Node: write → persist → reopen → read, and the Repo namespace methods work
// against the blob-backed SQLite. (The hosted data path itself is DoSqlBackend,
// proven in do-sql-backend.workers-spec.ts.)
// ---------------------------------------------------------------------------

test("DoBackend: data written through the Repo survives a fresh open (persist round-trip)", async () => {
  const store = new MemoryDurableStore();

  // "Session 1": one DO, one user's DB. Seed rules + write across namespaces.
  const repo1 = new SqliteRepo(new DoBackend(store));
  await repo1.categories.seed();
  await repo1.goals.upsert("Groceries", 600);
  const insrted = await repo1.transactions.insert({
    statement_id: null,
    source: "amex",
    account: "card",
    account_kind: "card",
    period: "2026-05",
    txn_date: "2026-05-04",
    description: "CORNER STORE",
    amount: 12.5,
    category: "Groceries",
    flow: "spend",
    dedup_key: "k1",
  });
  assert.equal(insrted, true);

  // Something is now persisted in DO storage.
  const stored = await store.get();
  assert.ok(stored, "a DB blob should have been persisted to the DurableStore");

  // "Session 2": a brand-new backend over the SAME store re-opens the persisted
  // blob (DO instance wakes from storage) and sees all the data.
  const repo2 = new SqliteRepo(new DoBackend(store));

  const goals = await repo2.goals.list();
  assert.equal(goals.length, 1);
  assert.equal(goals[0].category, "Groceries");
  assert.equal(goals[0].monthly_limit, 600);

  const { rows, total } = await repo2.transactions.list();
  assert.equal(total, 1);
  assert.equal(rows[0].description, "CORNER STORE");

  const rules = await repo2.categories.listRules();
  assert.ok(rules.length > 0, "seeded category rules should survive the reopen");
});

test("DoBackend: Repo namespace methods (summary/income/profile) work against the DO-backed SQLite", async () => {
  const store = new MemoryDurableStore();
  const repo = new SqliteRepo(new DoBackend(store));

  await repo.categories.seed();
  // A couple of card spends + an income deposit so summary/income have data.
  await repo.transactions.insert({
    statement_id: null, source: "amex", account: "card", account_kind: "card", period: "2026-05",
    txn_date: "2026-05-04", description: "GROCER A", amount: 40, category: "Groceries",
    flow: "spend", dedup_key: "a",
  });
  await repo.transactions.insert({
    statement_id: null, source: "amex", account: "card", account_kind: "card", period: "2026-05",
    txn_date: "2026-05-09", description: "GROCER B", amount: 60, category: "Groceries",
    flow: "spend", dedup_key: "b",
  });
  await repo.transactions.insert({
    statement_id: null, source: "cibc_chequing", account: "chequing", account_kind: "chequing", period: "2026-05",
    txn_date: "2026-05-01", description: "PEOPLE CENTER PAYROLL", amount: 3000, category: "Banking",
    flow: "income", dedup_key: "c",
  });

  // Cross-section of the namespaces SqliteRepo exposes — they must run unchanged.
  const monthly = await repo.summary.monthlyTotals(12);
  assert.ok(monthly.some((m) => m.month === "2026-05"), "summary.monthlyTotals sees the spend");

  const breakdown = await repo.summary.categoryBreakdown("2026-05");
  const groceries = breakdown.find((c) => c.category === "Groceries");
  assert.equal(groceries?.total, 100);

  const income = await repo.income.monthly(12);
  assert.ok(income.some((m) => m.total === 3000), "income.monthly sees the payroll deposit");

  const health = await repo.profile.dataHealth();
  assert.ok(health, "profile.dataHealth runs against the DO-backed DB");

  // waitlist namespace (write + read) also works end to end.
  const joined = await repo.waitlist.join("a@example.com");
  assert.ok(joined);
  assert.equal(await repo.waitlist.count(), 1);
  // list() backs the admin CSV export — it must round-trip through the DO RPC.
  const entries = await repo.waitlist.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.email, "a@example.com");
  assert.equal(entries[0]!.source, "homepage");
});

test("DoBackend: migrations run at first access (idempotent, full schema present)", async () => {
  const store = new MemoryDurableStore();
  const backend = new DoBackend(store);
  const db = await backend.open();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);

  for (const expected of [
    "transactions", "statements", "category_rules", "category_overrides",
    "spending_goals", "app_user", "manual_entries", "waitlist", "imports",
    "subscription_marks", "v_transactions",
  ]) {
    assert.ok(tables.includes(expected), `migrations should create ${expected}`);
  }

  // All eight migrations recorded; re-running is a no-op (idempotent).
  const before = db.prepare("SELECT COUNT(*) c FROM _migrations").get() as { c: number };
  assert.equal(before.c, 8);
  runMigrationsFromStrings(db);
  const after = db.prepare("SELECT COUNT(*) c FROM _migrations").get() as { c: number };
  assert.equal(after.c, 8, "re-running migrations must not duplicate rows");

  await backend.close();
});
