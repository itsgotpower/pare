import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { SqliteRepo } from "./sqlite-repo";
import { DoSqlBackend } from "./do-sql-backend";
import { runMigrationsOnDoSql } from "./do-sql-backend";
import { DoSqlDatabase, type DoStorageWithSql } from "./do-sql-adapter";
import { MIGRATIONS } from "../db/migrations";

// These tests run INSIDE workerd (via @cloudflare/vitest-pool-workers), so
// `ctx.storage.sql` is Cloudflare's REAL native SQLite — exactly the surface the
// adapter must bridge. better-sqlite3 is never loaded here (it can't on workerd);
// the whole point is to prove the lib/db/* synchronous query layer runs unchanged
// over the DO SQL adapter. runInDurableObject() hands us a real DO `ctx`.

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_SQL: DurableObjectNamespace;
  }
}

// Each test gets a fresh DO instance (unique id) == an isolated SQLite DB.
let counter = 0;
function freshStub() {
  const id = env.TEST_SQL.idFromName(`t-${counter++}-${Math.random()}`);
  return env.TEST_SQL.get(id);
}

// Run `fn` with a real DO ctx whose storage exposes the native sql API.
async function withCtx<T>(fn: (storage: DoStorageWithSql) => Promise<T> | T): Promise<T> {
  const stub = freshStub();
  return runInDurableObject(stub, async (_instance, ctx) => {
    return fn(ctx.storage as unknown as DoStorageWithSql);
  });
}

describe("DoSqlBackend over real ctx.storage.sql (workerd)", () => {
  it("migrations build the FULL schema incl. the v_transactions VIEW", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      const names = db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name"
        )
        .all<{ name: string; type: string }>();
      const byName = new Map(names.map((r) => [r.name, r.type]));

      for (const t of [
        "transactions",
        "statements",
        "category_rules",
        "category_overrides",
        "spending_goals",
        "app_user",
        "manual_entries",
        "waitlist",
        "imports",
        "transaction_splits",
      ]) {
        expect(byName.get(t), `table ${t} created`).toBe("table");
      }
      // The documented unknown #2: CREATE VIEW works on DO SQLite.
      expect(byName.get("v_transactions"), "v_transactions VIEW created on DO SQLite").toBe(
        "view"
      );
      expect(byName.get("v_category_slices"), "v_category_slices VIEW created on DO SQLite").toBe(
        "view"
      );

      // Idempotent re-run records no duplicate migration rows.
      const before = db.prepare("SELECT COUNT(*) c FROM _migrations").get<{ c: number }>()!;
      runMigrationsOnDoSql(db);
      const after = db.prepare("SELECT COUNT(*) c FROM _migrations").get<{ c: number }>()!;
      expect(after.c).toBe(before.c);
      // Derived, so a new migration can't rot this assertion (the old
      // hardcoded count broke on every schema addition).
      expect(before.c).toBe(MIGRATIONS.length);
    });
  });

  it("DOCUMENTED UNKNOWN #1: foreign keys are ENFORCED on DO SQLite", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      // category_overrides.transaction_id has a FK -> transactions(id). Inserting an
      // override for a non-existent transaction must fail IF FKs are enforced.
      let threw = false;
      try {
        db.prepare(
          "INSERT INTO category_overrides (transaction_id, original_category, new_category) VALUES (?, ?, ?)"
        ).run(999999, "A", "B");
      } catch (e) {
        threw = true;
        expect(String(e)).toMatch(/FOREIGN KEY|constraint/i);
      }
      expect(threw, "DO SQLite enforces the FK (PRAGMA foreign_keys default ON)").toBe(true);
    });
  });

  it("named-param adapter round-trips writes+reads (@name run(obj) + positional get)", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      // NAMED params via run(rowObject) — the exact shape lib/db's insertTransaction uses.
      const ins = db.prepare(`
        INSERT OR IGNORE INTO transactions
          (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key)
        VALUES
          (@statement_id, @source, @account, @period, @txn_date, @description, @amount, @category, @flow, @dedup_key)
      `);
      const row = {
        statement_id: null,
        source: "amex",
        account: "card",
        period: "2026-05",
        txn_date: "2026-05-04",
        description: "CORNER STORE",
        amount: 12.5,
        category: "Groceries",
        flow: "spend",
        dedup_key: "k1",
      };
      const res = ins.run(row);
      expect(res.changes).toBe(1);
      // INSERT OR IGNORE of the same dedup_key => 0 changes (the dedup contract).
      expect(ins.run(row).changes).toBe(0);

      // lastInsertRowid is fetched lazily and is a real rowid.
      const res2 = ins.run({ ...row, dedup_key: "k2" });
      expect(Number(res2.lastInsertRowid)).toBeGreaterThan(0);

      // Positional get(?) — the lib/db getTransactionCategory shape.
      const cat = db
        .prepare("SELECT category FROM transactions WHERE dedup_key = ?")
        .get<{ category: string }>("k1");
      expect(cat?.category).toBe("Groceries");

      // Named params in a SELECT via .all(obj), ignoring extra object keys.
      const rows = db
        .prepare("SELECT * FROM transactions WHERE source = @source ORDER BY id")
        .all<{ description: string }>({ source: "amex", unused: "ignored" });
      expect(rows.map((r) => r.description)).toEqual(["CORNER STORE", "CORNER STORE"]);

      // The v_transactions view resolves effective_category through the LEFT JOIN.
      const v = db
        .prepare(
          "SELECT effective_category FROM v_transactions WHERE dedup_key = @k"
        )
        .get<{ effective_category: string }>({ k: "k1" });
      expect(v?.effective_category).toBe("Groceries");
    });
  });

  it("bindingsFor THROWS on a MISSING named param, but binds an explicit null", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      const ins = db.prepare(`
        INSERT INTO transactions
          (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key)
        VALUES
          (@statement_id, @source, @account, @period, @txn_date, @description, @amount, @category, @flow, @dedup_key)
      `);

      // A row OBJECT that OMITS @amount entirely -> a missing-key error (matches
      // better-sqlite3's "Missing named parameter"), NOT a silent bind-to-null.
      const incomplete = {
        statement_id: null, source: "amex", account: "card", period: "2026-05",
        txn_date: "2026-05-04", description: "X", /* amount missing */ category: "G",
        flow: "spend", dedup_key: "miss",
      };
      expect(() => ins.run(incomplete as never)).toThrow(/missing named parameter: @amount/);

      // An EXPLICIT null for a nullable column (statement_id) binds fine (present key).
      const ok = {
        statement_id: null, source: "amex", account: "card", period: "2026-05",
        txn_date: "2026-05-04", description: "Y", amount: 12.5, category: "G",
        flow: "spend", dedup_key: "ok",
      };
      expect(ins.run(ok).changes).toBe(1);

      // A SUPERSET (extra keys) is still accepted — only referenced placeholders matter.
      expect(ins.run({ ...ok, dedup_key: "ok2", extra: "ignored" } as never).changes).toBe(1);
    });
  });

  it("INTEGER columns come back as number (not bigint) from get()/all()", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      db.prepare(
        "INSERT INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?)"
      ).run("Coffee", "STARBUCKS", 0);

      // A SELECT of an INTEGER column (COUNT) must be a plain JS number, not bigint,
      // so lib/db's `=== 1`, pagination math, and Response.json behave as on
      // better-sqlite3 (DO SQLite returns INTEGER as bigint without the coercion).
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM category_rules")
        .get<{ c: number }>()!;
      expect(typeof row.c).toBe("number");
      expect(row.c).toBe(1);

      // all() coerces too.
      const rows = db
        .prepare("SELECT id, sort_order FROM category_rules")
        .all<{ id: number; sort_order: number }>();
      expect(typeof rows[0].id).toBe("number");
      expect(typeof rows[0].sort_order).toBe("number");

      // EXISTS(...) (the has_override shape) comes back as number 0/1, so `=== 1` works.
      const ex = db
        .prepare("SELECT EXISTS(SELECT 1 FROM category_rules) AS has")
        .get<{ has: number }>()!;
      expect(typeof ex.has).toBe("number");
      expect(ex.has).toBe(1);
    });
  });

  it("transaction() wrapper commits a batch and rolls back on throw", async () => {
    await withCtx(async (storage) => {
      const db = new DoSqlDatabase(storage);
      runMigrationsOnDoSql(db);

      const ins = db.prepare(
        "INSERT OR IGNORE INTO category_rules (category, keyword, sort_order) VALUES (?, ?, ?)"
      );
      // Commit path: db.transaction(fn)(args) returns fn's value (mirrors lib/db).
      const run = db.transaction((pairs: [string, string][]) => {
        let n = 0;
        pairs.forEach(([c, k], i) => {
          if (ins.run(c, k, i).changes > 0) n++;
        });
        return n;
      });
      const inserted = run([
        ["Coffee", "STARBUCKS"],
        ["Groceries", "COSTCO"],
      ]);
      expect(inserted).toBe(2);
      expect(
        db.prepare("SELECT COUNT(*) c FROM category_rules").get<{ c: number }>()!.c
      ).toBe(2);

      // Rollback path: throwing inside the txn undoes its writes.
      const bad = db.transaction(() => {
        ins.run("X", "ZZZ", 99);
        throw new Error("boom");
      });
      expect(() => bad()).toThrow("boom");
      expect(
        db.prepare("SELECT COUNT(*) c FROM category_rules").get<{ c: number }>()!.c
      ).toBe(2);
    });
  });

  it("rule mutations succeed in workerd despite node:fs being an unenv stub", async () => {
    // Regression: addRule/deleteRule/importRules also persist a self-host
    // wipe-survival JSON via node:fs. On Workers the unenv fs stub THROWS
    // ("fs.mkdirSync is not implemented") AFTER the DB insert committed, so
    // every hosted rule write (the /categories UI, rules import, and the MCP
    // add_category_rule tool) reported failure while silently succeeding.
    // The persist is now hosted-skipped and best-effort — these calls must
    // complete in the real Workers runtime.
    await withCtx(async (storage) => {
      const repo = new SqliteRepo(new DoSqlBackend(storage));
      await repo.categories.seed();

      await repo.categories.addRule("Test category", "WORKERSPEC MERCHANT");
      const rules = await repo.categories.listRules();
      expect(rules.some((r) => r.keyword === "WORKERSPEC MERCHANT")).toBe(true);

      await repo.categories.importRules([
        { category: "Groceries", keyword: "WORKERSPEC IMPORT" },
      ]);
      const after = await repo.categories.listRules();
      expect(after.some((r) => r.keyword === "WORKERSPEC IMPORT")).toBe(true);

      const target = after.find((r) => r.keyword === "WORKERSPEC MERCHANT")!;
      await repo.categories.deleteRule(target.id);
      const gone = await repo.categories.listRules();
      expect(gone.some((r) => r.keyword === "WORKERSPEC MERCHANT")).toBe(false);
    });
  });

  it("the existing Repo namespace methods work unchanged over DoSqlBackend", async () => {
    await withCtx(async (storage) => {
      const repo = new SqliteRepo(new DoSqlBackend(storage));

      await repo.categories.seed();
      await repo.goals.upsert("Groceries", 600);

      const inserted = await repo.transactions.insert({
        statement_id: null,
        source: "amex",
        account: "card",
        account_kind: "card",
        period: "2026-05",
        txn_date: "2026-05-04",
        description: "GROCER A",
        amount: 40,
        category: "Groceries",
        flow: "spend",
        dedup_key: "a",
      });
      expect(inserted).toBe(true);

      const bulk = await repo.transactions.insertMany([
        {
          statement_id: null, source: "amex", account: "card", account_kind: "card", period: "2026-05",
          txn_date: "2026-05-09", description: "GROCER B", amount: 60, category: "Groceries",
          flow: "spend", dedup_key: "b",
        },
        {
          statement_id: null, source: "cibc_chequing", account: "chequing", account_kind: "chequing", period: "2026-05",
          txn_date: "2026-05-01", description: "PEOPLE CENTER PAYROLL", amount: 3000,
          category: "Banking", flow: "income", dedup_key: "c",
        },
        // duplicate dedup_key -> skipped (proves INSERT OR IGNORE + changes counting
        // inside db.transaction() batch).
        {
          statement_id: null, source: "amex", account: "card", account_kind: "card", period: "2026-05",
          txn_date: "2026-05-04", description: "GROCER A", amount: 40, category: "Groceries",
          flow: "spend", dedup_key: "a",
        },
      ]);
      expect(bulk.inserted).toBe(2);
      expect(bulk.skipped).toBe(1);

      // summary.* (monthlyTotals / categoryBreakdown) over v_transactions.
      const monthly = await repo.summary.monthlyTotals(12);
      expect(monthly.some((m) => m.month === "2026-05")).toBe(true);
      const breakdown = await repo.summary.categoryBreakdown("2026-05");
      expect(breakdown.find((c) => c.category === "Groceries")?.total).toBe(100);

      // income.monthly sees the payroll deposit.
      const income = await repo.income.monthly(12);
      expect(income.some((m) => m.total === 3000)).toBe(true);

      // transactions.list (named limit/offset + computed has_override) + categories.
      const { rows, total } = await repo.transactions.list({ source: "amex" });
      expect(total).toBe(2);
      expect(rows.every((r) => r.source === "amex")).toBe(true);

      // Regression: UNFILTERED list() — the COUNT query has ZERO placeholders but is
      // still called with an (empty) params object. The adapter must bind nothing,
      // not the object itself ("Wrong number of parameter bindings").
      const allTxns = await repo.transactions.list();
      expect(allTxns.total).toBe(3);
      expect(allTxns.rows.length).toBe(3);

      // override write (FK to transactions) + view reflects it.
      const target = rows[0];
      await repo.categories.addOverride(target.id, target.category, "Coffee");
      const after = await repo.transactions.list({ category: "Coffee" });
      expect(after.total).toBe(1);
      expect(after.rows[0].has_override).toBe(1);

      // netWorth.addEntry returns lastInsertRowid (Number(result.lastInsertRowid)).
      const entryId = await repo.netWorth.addEntry({
        name: "TFSA", kind: "asset", amount: 5000, effective_date: "2026-05-01", note: null,
      });
      expect(entryId).toBeGreaterThan(0);

      // statements.insert uses INSERT ... ON CONFLICT ... RETURNING id via .get(obj).
      const stmtId = await repo.statements.insert({
        filename: "amex-2026-05.pdf", source: "amex", account: "card", account_kind: "card",
        period: "2026-05", row_count: 3, closing_balance: 123.45, closing_date: "2026-05-31",
      });
      expect(stmtId).toBeGreaterThan(0);

      // waitlist (write + read).
      expect(await repo.waitlist.join("a@example.com")).toBeTruthy();
      expect(await repo.waitlist.count()).toBe(1);

      // profile.dataHealth runs end to end against the DO-backed DB.
      expect(await repo.profile.dataHealth()).toBeTruthy();
    });
  });

  it("statements.deleteById removes the statement + its transactions and overrides", async () => {
    await withCtx(async (storage) => {
      const backend = new DoSqlBackend(storage);
      const repo = new SqliteRepo(backend);

      const stmtId = await repo.statements.insert({
        filename: "visa-2026-05.pdf", source: "cibc_visa", account: "card", account_kind: "card",
        period: "2026-05", row_count: 1,
      });
      await repo.transactions.insert({
        statement_id: stmtId, source: "cibc_visa", account: "card", account_kind: "card", period: "2026-05",
        txn_date: "2026-05-09", description: "PARSED CHARGE", amount: 20, category: "Other / uncategorized",
        flow: "spend", dedup_key: "del-stmt-1",
      });
      const [target] = (await repo.transactions.list()).rows;
      await repo.categories.addOverride(target.id, target.category, "Coffee");

      const res = await repo.statements.deleteById(stmtId);
      expect(res.deleted).toBe(1);
      expect(res.transactions).toBe(1);
      expect((await repo.statements.list()).length).toBe(0);
      expect((await repo.transactions.list()).total).toBe(0);

      // Unknown id is a no-op.
      const none = await repo.statements.deleteById(stmtId);
      expect(none.deleted).toBe(0);
      expect(none.transactions).toBe(0);
    });
  });

  it("destroy() hard-deletes every app table + view (account deletion)", async () => {
    await withCtx(async (storage) => {
      const backend = new DoSqlBackend(storage);
      const repo = new SqliteRepo(backend);

      // Populate a parent (transactions) + child (override, FK to transactions) so
      // the FK-aware drop ordering is exercised, plus the v_transactions VIEW.
      const inserted = await repo.transactions.insert({
        statement_id: null, source: "amex", account: "card", account_kind: "card", period: "2026-05",
        txn_date: "2026-05-09", description: "GROCER", amount: 60, category: "Groceries",
        flow: "spend", dedup_key: "z",
      });
      expect(inserted).toBe(true);
      const [target] = (await repo.transactions.list()).rows;
      await repo.categories.addOverride(target.id, target.category, "Coffee");

      const listObjects = () =>
        (storage.sql as unknown as {
          exec: (q: string) => { toArray: () => { name: string; type: string }[] };
        })
          .exec(
            "SELECT name, type FROM sqlite_master " +
              "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
          )
          .toArray();

      expect(listObjects().length).toBeGreaterThan(0);

      await backend.destroy();

      // Every app table + the view are gone.
      expect(listObjects()).toEqual([]);

      // Idempotent: a second destroy on the empty DB doesn't throw.
      await backend.destroy();
      expect(listObjects()).toEqual([]);
    });
  });
});
