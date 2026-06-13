// A better-sqlite3-SHAPED adapter over a Durable Object's native SQLite storage
// API (`ctx.storage.sql`). It exists so the synchronous, regression-tested
// lib/db/*.ts query layer — written against better-sqlite3 — runs UNCHANGED on
// Cloudflare workerd, where the native better-sqlite3 module cannot load.
//
// Both sides are synchronous: better-sqlite3 is sync, and DO `sql.exec()`
// completes synchronously (the cursor is consumed eagerly here, before any
// await), with transactions via `ctx.storage.transactionSync`. So this is a pure
// shape translation, no async bridging.
//
// The hard part is PARAMETER BINDING. lib/db uses better-sqlite3's NAMED
// placeholders (`@statement_id`) and passes a row OBJECT to `stmt.run(row)`,
// while DO `sql.exec(query, ...bindings)` takes ONLY POSITIONAL `?` params. So
// the adapter, at prepare() time, rewrites every `@name` placeholder to `?` and
// records the name order; at call time, if a single plain object is passed it
// pulls each binding from that object IN PLACEHOLDER ORDER (extra object keys are
// ignored — lib/db routinely passes a superset, e.g. `{...params, limit, offset}`).
// If positional primitives are passed instead (`stmt.get(id)`), they are used
// as-is. The two calling styles never mix in lib/db, so the heuristic is safe.

// The slice of Cloudflare's SqlStorage surface we depend on. Declared structurally
// so this module needs no @cloudflare/workers-types and tests can supply a fake.
export interface DoSqlCursor<R = Record<string, SqlValue>> {
  toArray(): R[];
  one(): R;
  raw(): IterableIterator<SqlValue[]>;
  columnNames: string[];
  rowsRead: number;
  rowsWritten: number;
  next(): { done?: boolean; value?: R };
}

export interface DoSqlStorage {
  exec<R = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): DoSqlCursor<R>;
}

// The DO ctx.storage surface we use: the `sql` sub-API plus the synchronous
// transaction wrapper (`transactionSync(cb)` runs cb in a transaction, returns
// its result, rolls back on throw).
export interface DoStorageWithSql {
  sql: DoSqlStorage;
  transactionSync<T>(callback: () => T): T;
}

export type SqlValue = string | number | bigint | boolean | null | ArrayBuffer | Uint8Array;

// Result of a write, matching better-sqlite3's RunResult.
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// A param object is a single plain (non-array, non-primitive) object — the NAMED
// calling convention. Anything else is treated as positional args.
function isNamedParams(args: unknown[]): args is [Record<string, SqlValue>] {
  if (args.length !== 1) return false;
  const a = args[0];
  return (
    typeof a === "object" &&
    a !== null &&
    !Array.isArray(a) &&
    !(a instanceof Uint8Array) &&
    !(a instanceof ArrayBuffer)
  );
}

// Rewrite better-sqlite3 named placeholders (`@name`) to positional `?` and return
// the ordered list of names. Skips `@` inside string/quoted literals so a literal
// like '%@x%' is never mistaken for a placeholder. Only `@`-style names are used
// by lib/db (no `:name`/`$name`), so we handle just that form.
function parseNamedParams(sql: string): { rewritten: string; names: string[] } {
  const names: string[] = [];
  let out = "";
  let i = 0;
  let quote: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (quote) {
      out += ch;
      // Handle doubled-quote escapes inside the literal ('' or "").
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i += 2;
          continue;
        }
        quote = null;
      }
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === "@") {
      // Read the identifier after '@'.
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
      if (j > i + 1) {
        names.push(sql.slice(i + 1, j));
        out += "?";
        i = j;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return { rewritten: out, names };
}

// Resolve the positional binding array for a prepared statement from the args the
// caller passed: NAMED → pull from the object in placeholder order; POSITIONAL →
// use the args as-is.
function bindingsFor(names: string[], args: unknown[]): SqlValue[] {
  // A single plain object is ALWAYS the named-params convention — independent of
  // how many placeholders the query has. When the query has zero placeholders
  // (names is empty), this correctly binds NOTHING: e.g. lib/db calls
  // `db.prepare("SELECT COUNT(*) FROM v_transactions <where>").get(params)` where,
  // with no filters, <where> is empty and params is `{}`. The old `names.length > 0`
  // guard fell through to the positional branch and bound the object itself as one
  // value → "Wrong number of parameter bindings" on every unfiltered list().
  if (isNamedParams(args)) {
    const obj = args[0];
    return names.map((n) => {
      const v = obj[n];
      return v === undefined ? null : (v as SqlValue);
    });
  }
  // Positional call: better-sqlite3 also accepts an array spread; here lib/db
  // always passes loose args (`get(a, b)`), so use them directly.
  return args as SqlValue[];
}

// A prepared statement bound to a SQL string. better-sqlite3 prepares once and
// runs many times with different params; DO sql.exec re-parses each call, so this
// just memoises the placeholder rewrite and re-execs per call.
export class DoSqlStatement {
  private rewritten: string;
  private names: string[];

  constructor(
    private sql: DoSqlStorage,
    source: string
  ) {
    const parsed = parseNamedParams(source);
    this.rewritten = parsed.rewritten;
    this.names = parsed.names;
  }

  // First row, or undefined if none. better-sqlite3 returns `undefined` (callers
  // coalesce to null), so we must NOT use cursor.one() (which throws on 0 rows).
  get<R = Record<string, SqlValue>>(...args: unknown[]): R | undefined {
    const cursor = this.sql.exec<R>(this.rewritten, ...bindingsFor(this.names, args));
    const first = cursor.next();
    return first.done ? undefined : (first.value as R);
  }

  // All rows.
  all<R = Record<string, SqlValue>>(...args: unknown[]): R[] {
    return this.sql.exec<R>(this.rewritten, ...bindingsFor(this.names, args)).toArray();
  }

  // Execute a write; return { changes, lastInsertRowid } matching better-sqlite3's
  // RunResult.
  //
  // `changes` MUST come from SQLite's `changes()` function — the count of rows
  // modified by the last INSERT/UPDATE/DELETE — NOT from the cursor's
  // `rowsWritten`, which on DO SQLite also counts index/internal page writes (a
  // single insert into the indexed `transactions` table reports rowsWritten ≈ 7,
  // not 1). The dedup contract `stmt.run(row).changes > 0` would then never see a
  // skip. A trailing `SELECT changes(), last_insert_rowid()` reads both counters:
  // a plain SELECT does not reset them, so they still reflect the write above.
  run(...args: unknown[]): RunResult {
    // Run the write; consume its (empty) cursor synchronously.
    this.sql.exec(this.rewritten, ...bindingsFor(this.names, args)).toArray();
    const meta = this.sql
      .exec<{ changes: number | bigint; rowid: number | bigint }>(
        "SELECT changes() AS changes, last_insert_rowid() AS rowid"
      )
      .one();
    return {
      changes: Number(meta.changes),
      lastInsertRowid: meta.rowid,
    };
  }

  // Row iterator (better-sqlite3 `.iterate()`); kept for completeness — lib/db does
  // not currently use it, but the Repo contract may grow into it.
  *iterate<R = Record<string, SqlValue>>(...args: unknown[]): IterableIterator<R> {
    const rows = this.sql.exec<R>(this.rewritten, ...bindingsFor(this.names, args)).toArray();
    yield* rows;
  }
}

// The better-sqlite3 `Database`-shaped facade over DO `ctx.storage`.
export class DoSqlDatabase {
  constructor(private storage: DoStorageWithSql) {}

  prepare(source: string): DoSqlStatement {
    return new DoSqlStatement(this.storage.sql, source);
  }

  // Execute one or more semicolon-separated statements with no bindings — used by
  // the migration runner (`db.exec(sql)`). DO sql.exec accepts multiple statements
  // in one string, so this is a direct pass-through.
  exec(sql: string): void {
    this.storage.sql.exec(sql);
  }

  // better-sqlite3 `db.transaction(fn)` returns a function that, when called, runs
  // fn inside a transaction and returns fn's result. DO gives us
  // transactionSync(cb) with the same semantics (rollback on throw). The returned
  // wrapper forwards its args to fn, matching `const run = db.transaction(...); run(rows)`.
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => this.storage.transactionSync(() => fn(...args));
  }

  // better-sqlite3 `db.pragma(...)`. DO SQLite enforces foreign keys by default and
  // does not honour `PRAGMA foreign_keys = ON|OFF` via this path (it cannot be
  // toggled mid-connection the way better-sqlite3 allows), nor `journal_mode`
  // (storage is managed by the platform). The only pragma lib/db issues at the
  // adapter is `foreign_keys = ON` (already the DO default) — so this is a safe
  // no-op. Returns [] to match better-sqlite3's array-returning shape.
  pragma(_source: string): unknown[] {
    return [];
  }
}
