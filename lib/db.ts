import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./db/migrate";

// PARSE_DB_PATH lets the MCP server (launched with an unknown cwd) point at the
// real DB; the Next app falls back to <cwd>/data/parse.db.
export const DB_PATH = process.env.PARSE_DB_PATH || path.join(process.cwd(), "data", "parse.db");
const DB_DIR = path.dirname(DB_PATH);

let _db: Database.Database | null = null;
let _override: Database.Database | null = null;

// Lets a DbBackend (e.g. EncryptedBlobBackend) route getDb() — and therefore the
// delegated lib/db/* query functions — at a connection it owns (a decrypted
// in-memory DB), instead of the file singleton. Pass null to restore the default.
// One-connection-at-a-time is correct for the target model (one Durable Object
// per user); the file singleton path below is unchanged when no override is set.
export function useConnection(db: Database.Database | null): void {
  _override = db;
}

export function getDb(): Database.Database {
  if (_override) return _override;
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);

  return _db;
}
