// DoSqlBackend — the LIVE Durable-Object-per-user data backend on Cloudflare.
//
// This is the replacement for the blob-based DoBackend (lib/repo/do-backend.ts).
// DoBackend stored the whole serialised SQLite DB as a blob and operated on it
// with the native better-sqlite3 module — which CANNOT load on workerd. This
// backend instead uses the Durable Object's NATIVE SQLite storage (ctx.storage.sql,
// synchronous), bridged to the synchronous better-sqlite3-shaped lib/db/*.ts code
// by DoSqlDatabase (do-sql-adapter.ts). lib/db/*.ts stays byte-for-byte unchanged.
//
// Because the DO's SQLite IS the durable store (every exec() writes through to
// storage natively), there is NO serialise/blob step: open() builds the adapter,
// runs migrations once, and routes getDb() at the adapter via useConnection();
// persist() is a NO-OP. The DO instance boundary is the per-user isolation, exactly
// as before — this backend has zero auth knowledge.

import { useConnection } from "../db";
import { MIGRATIONS, type Migration } from "../db/migrations";
import type { DbBackend } from "./backend";
import { DoSqlDatabase, type DoStorageWithSql } from "./do-sql-adapter";

// Idempotent, declaration-ordered migration runner over the bundled SQL strings,
// operating through the DoSqlDatabase adapter (so the SAME MIGRATIONS that build
// the schema under better-sqlite3 build it on DO SQLite). Mirrors
// lib/db/migrate.ts / do-backend.ts's runMigrationsFromStrings, but typed at the
// adapter rather than better-sqlite3.
//
// NOTE: DO SQLite does not support `PRAGMA user_version`; this runner tracks
// applied migrations in a `_migrations` table instead (same approach lib/db uses),
// so that limitation does not bite us.
export function runMigrationsOnDoSql(
  db: DoSqlDatabase,
  migrations: readonly Migration[] = MIGRATIONS
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT name FROM _migrations")
      .all<{ name: string }>()
      .map((row) => row.name)
  );

  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  }
}

export class DoSqlBackend implements DbBackend {
  private db: DoSqlDatabase | null = null;

  constructor(private storage: DoStorageWithSql) {}

  // The adapter is a better-sqlite3-shaped facade, not a real better-sqlite3
  // Database. The DbBackend contract is typed at better-sqlite3 for the file/blob
  // backends; here we satisfy the same structural surface lib/db actually uses
  // (prepare/exec/transaction/pragma) and route getDb() at it via useConnection().
  // The cast is the seam where the shapes meet — intentional and localised.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async open(): Promise<any> {
    // Re-assert this DO's connection as the active one on EVERY open() (see the
    // identical reasoning in DoBackend): useConnection() is a process-global
    // override, so when several backends coexist in one process (in-process tests)
    // each op must re-point the global at its own adapter. On a real DO each
    // instance owns its isolate, so this is belt-and-suspenders there.
    if (this.db) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useConnection(this.db as any);
      return this.db;
    }

    const db = new DoSqlDatabase(this.storage);
    // foreign_keys are ON by default on DO SQLite; the adapter's pragma() is a
    // no-op (it cannot be toggled here), so we do not call it.
    runMigrationsOnDoSql(db); // idempotent: builds schema first time, no-op after.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useConnection(db as any);
    this.db = db;
    return db;
  }

  // Native writes go straight to DO storage; there is nothing to serialise/flush.
  async persist(): Promise<void> {
    // no-op
  }

  async close(): Promise<void> {
    useConnection(null);
    this.db = null;
  }

  // Hard-delete EVERY app table + view from this DO's native SQLite (account
  // deletion). `ctx.storage.deleteAll()` does NOT remove SQL-API data on a
  // SQLite-backed DO — only DROP does — so this is how a user's database is truly
  // erased. Idempotent (IF EXISTS + re-runnable). After this the DO holds no
  // stored SQL data.
  //
  // FK enforcement is ON by DO default, so dropping a parent whose rows are still
  // referenced raises a constraint error. We drop views first (no FKs), then
  // tables in repeated passes — each pass drops whatever currently has no blocking
  // reference — until none remain. If a pass makes no progress (a cycle), we clear
  // rows then force the drop, swallowing per-statement errors.
  async destroy(): Promise<void> {
    const sql = this.storage.sql;
    const objects = sql
      .exec<{ name: string; type: string }>(
        "SELECT name, type FROM sqlite_master " +
          "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
      )
      .toArray();

    for (const v of objects.filter((o) => o.type === "view")) {
      sql.exec(`DROP VIEW IF EXISTS "${v.name}"`);
    }

    let tables = objects.filter((o) => o.type === "table").map((o) => o.name);
    while (tables.length > 0) {
      const remaining: string[] = [];
      let dropped = 0;
      for (const t of tables) {
        try {
          sql.exec(`DROP TABLE IF EXISTS "${t}"`);
          dropped++;
        } catch {
          remaining.push(t); // still referenced — retry next pass
        }
      }
      if (dropped === 0) {
        // No progress (FK cycle / stubborn refs): empty the rows, then drop.
        for (const t of remaining) {
          try {
            sql.exec(`DELETE FROM "${t}"`);
          } catch {
            /* ignore */
          }
        }
        for (const t of remaining) {
          try {
            sql.exec(`DROP TABLE IF EXISTS "${t}"`);
          } catch {
            /* ignore */
          }
        }
        break;
      }
      tables = remaining;
    }

    useConnection(null);
    this.db = null;
  }
}
