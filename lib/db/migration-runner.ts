// The ONE migration runner shared by every backend. Three copies used to live
// in lib/db/migrate.ts (Node better-sqlite3 file DB), lib/repo/do-backend.ts
// (blob-backed better-sqlite3) and lib/repo/do-sql-backend.ts (DO native SQLite
// via the better-sqlite3-shaped adapter) — same `_migrations` ledger + applied-set
// loop, differing only in the db type. This module is typed at the minimal
// structural surface all three satisfy and imports NOTHING from Node (no fs/path),
// so it bundles into a Cloudflare Worker unchanged.
//
// NOTE: DO SQLite does not support `PRAGMA user_version`; applied migrations are
// tracked in the `_migrations` table instead, so that limitation does not bite.

import { MIGRATIONS, type Migration } from "./migrations";

// The slice of a database the runner actually uses. better-sqlite3's Database and
// DoSqlDatabase (lib/repo/do-sql-adapter.ts) both satisfy it structurally. The
// statement methods take rest params (method syntax, so bivariance admits
// better-sqlite3's `Statement<[{}]> | Statement<unknown[]>` prepare() union even
// though this runner only ever calls `.all()` and `.run(name)`).
export interface MigrationDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): unknown;
  };
}

// Idempotent applied-set loop: ensure the ledger table, apply each migration not
// yet recorded, record it. Migrations run in the ORDER GIVEN — a caller that wants
// name ordering sorts before calling (runMigrationsFromStrings does; the generated
// MIGRATIONS array is already filename-sorted, so the default list is identical
// either way).
export function runMigrationList(
  db: MigrationDb,
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
      .all()
      .map((row) => (row as { name: string }).name)
  );

  for (const { name, sql } of migrations) {
    if (applied.has(name)) continue;

    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  }
}
