import Database from "better-sqlite3";
import { useConnection } from "../db";
import type { DbBackend } from "./backend";
import type { DurableStore } from "./do-store";

// Durable-Object-per-user backend (hosted target). One DO instance == one user's
// SQLite database. The whole serialised SQLite DB lives at rest as a single blob
// in the Durable Object's storage (which is itself SQLite-backed and durable);
// on open() that blob is loaded into an in-memory better-sqlite3 connection that
// every query runs against, and on persist() the connection is serialised
// (`db.serialize()`) and written back to DO storage.
//
// This mirrors EncryptedBlobBackend's shape exactly — read whole-DB blob → open
// in-memory connection → route getDb() at it (useConnection) so SqliteRepo's
// delegated lib/db/* functions operate on it transparently → serialise back on
// persist() — but swaps the BlobStore-with-crypto for a DurableStore over the
// DO's own storage. SqliteRepo sits on top unchanged.
//
// This backend has ZERO auth knowledge: it does not know which user it serves.
// The DO is already addressed by id by the time this runs; routing the request
// to the correct DO (and therefore the correct user's database) is Session 6's
// job, not this file's.
//
// Note (batching, inherited from SqliteRepo): persist() serialises + writes the
// whole DB, so a write loop pays that cost per row. The same insertMany()/
// write-boundary follow-up tracked for EncryptedBlobBackend applies here.

// The blob store + its DO-backed and in-memory implementations live in do-store.ts
// (no better-sqlite3 dependency) so they can be bundled into a Worker. Re-exported
// here so callers can import everything from "./do-backend".
export {
  DurableObjectStore,
  MemoryDurableStore,
  CHUNK_BYTES,
} from "./do-store";
export type { DurableStore, DurableStorageLike } from "./do-store";

// --- Local bundled-migrations shim -----------------------------------------
//
// lib/db/migrate.ts currently reads .sql files from disk via fs, which cannot
// work inside a Cloudflare Worker / Durable Object — there is no filesystem.
// Session 4 is changing runMigrations() to consume bundled SQL strings instead.
// Until that merges into this worktree we cannot import it, so this is a small
// local shim implementing the same name-ordered, idempotent contract against an
// in-memory array of { name, sql } records.
//
// TODO(session-6 merge): replace this shim with the bundled migrations exported
// by Session 4's runMigrations() (consume bundled SQL strings, drop this array
// and runMigrationsFromStrings()).
export interface BundledMigration {
  name: string;
  sql: string;
}

// The schema as bundled strings, mirroring lib/db/migrations/*.sql in filename
// order. Kept in sync with those files until Session 4's bundler owns them.
export const BUNDLED_MIGRATIONS: BundledMigration[] = [
  {
    name: "001_init.sql",
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS statements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT UNIQUE NOT NULL,
          source TEXT NOT NULL,
          account TEXT NOT NULL,
          period TEXT NOT NULL,
          uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
          row_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          statement_id INTEGER REFERENCES statements(id),
          source TEXT NOT NULL,
          account TEXT NOT NULL,
          period TEXT NOT NULL,
          txn_date TEXT NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          flow TEXT NOT NULL CHECK (flow IN ('spend', 'payment', 'income', 'transfer', 'fee_interest')),
          dedup_key TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_txn_date ON transactions(txn_date);
      CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
      CREATE INDEX IF NOT EXISTS idx_transactions_flow ON transactions(flow);
      CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
      CREATE TABLE IF NOT EXISTS category_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          keyword TEXT UNIQUE NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS category_overrides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id INTEGER UNIQUE NOT NULL REFERENCES transactions(id),
          original_category TEXT NOT NULL,
          new_category TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS spending_goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT UNIQUE NOT NULL,
          monthly_limit REAL NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIEW IF NOT EXISTS v_transactions AS
      SELECT
          t.*,
          COALESCE(co.new_category, t.category) AS effective_category
      FROM transactions t
      LEFT JOIN category_overrides co ON co.transaction_id = t.id;
    `,
  },
  {
    name: "002_auth.sql",
    sql: `
      CREATE TABLE IF NOT EXISTS app_user (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: "003_password_changed_at.sql",
    sql: `
      ALTER TABLE app_user ADD COLUMN password_changed_at TEXT;
      UPDATE app_user SET password_changed_at = created_at WHERE password_changed_at IS NULL;
    `,
  },
  {
    name: "004_net_worth.sql",
    sql: `
      ALTER TABLE statements ADD COLUMN closing_balance REAL;
      ALTER TABLE statements ADD COLUMN closing_date TEXT;
      CREATE TABLE IF NOT EXISTS manual_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
          amount REAL NOT NULL,
          effective_date TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_manual_entries_name_date
          ON manual_entries(name, effective_date);
    `,
  },
  {
    name: "005_waitlist.sql",
    sql: `
      CREATE TABLE IF NOT EXISTS waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'homepage',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];

// Idempotent, name-ordered migration runner over bundled SQL strings — the
// Worker-safe equivalent of lib/db/migrate.ts's fs-based runMigrations().
// TODO(session-6 merge): drop in favour of Session 4's runMigrations().
export function runMigrationsFromStrings(
  db: Database.Database,
  migrations: BundledMigration[] = BUNDLED_MIGRATIONS
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

  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, sql } of ordered) {
    if (applied.has(name)) continue;
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
  }
}

export class DoBackend implements DbBackend {
  private db: Database.Database | null = null;

  constructor(private store: DurableStore) {}

  async open(): Promise<Database.Database> {
    if (this.db) return this.db;

    const blob = await this.store.get();
    const db = blob
      ? new Database(Buffer.from(blob)) // load persisted DB → in-memory connection
      : new Database(); // first access for this DO: fresh in-memory DB

    db.pragma("foreign_keys = ON");
    // Run schema migrations at first access. Idempotent: builds the schema on a
    // fresh DB, no-op on an already-migrated one.
    runMigrationsFromStrings(db);

    useConnection(db);
    this.db = db;
    return db;
  }

  async persist(db: Database.Database): Promise<void> {
    await this.store.put(new Uint8Array(db.serialize()));
  }

  async close(): Promise<void> {
    useConnection(null);
    this.db?.close();
    this.db = null;
  }
}
