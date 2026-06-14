import type Database from "better-sqlite3";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { runMigrations } from "./db/migrate";

// PARE_DB_PATH lets the MCP server (launched with an unknown cwd) point at the
// real DB; the Next app falls back to <cwd>/data/pare.db.
export const DB_PATH = process.env.PARE_DB_PATH || path.join(process.cwd(), "data", "pare.db");
const DB_DIR = path.dirname(DB_PATH);

let _db: Database.Database | null = null;
let _override: Database.Database | null = null;

// `better-sqlite3` is a NATIVE module: importing it eagerly evaluates a `.node`
// binding, which crashes on Cloudflare workerd (the hosted Durable Object
// runtime) at module load — before any code runs. So we keep only a TYPE import
// at the top (erased at compile time) and load the runtime value LAZILY, inside
// getDb()'s file-singleton branch, which never executes on workerd: there a
// DbBackend installs an override connection (DoSqlBackend's ctx.storage.sql
// adapter) via useConnection() before any query, so getDb() returns `_override`
// and this loader is never reached. `fs`/`path` import fine on workerd
// (nodejs_compat polyfills them) so they stay as normal imports. createRequire is
// used instead of a bare `require()` so this stays valid ESM under Next's bundler.
let _loadDatabase: (() => typeof Database) | null = null;
function loadDatabase(): typeof Database {
  if (!_loadDatabase) {
    const req = createRequire(import.meta.url);
    _loadDatabase = () => req("better-sqlite3") as typeof Database;
  }
  return _loadDatabase();
}

// Lets a DbBackend (EncryptedBlobBackend, or DoSqlBackend's better-sqlite3-shaped
// adapter over a Durable Object's ctx.storage.sql) route getDb() — and therefore
// the delegated lib/db/* query functions — at a connection it owns (a decrypted
// in-memory DB, or the DO's native SQLite), instead of the file singleton. Pass
// null to restore the default. One-connection-at-a-time is correct for the target
// model (one Durable Object per user); the file singleton path below is unchanged
// when no override is set.
export function useConnection(db: Database.Database | null): void {
  _override = db;
}

export function getDb(): Database.Database {
  if (_override) return _override;
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const DatabaseCtor = loadDatabase();
  _db = new DatabaseCtor(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);

  return _db;
}
