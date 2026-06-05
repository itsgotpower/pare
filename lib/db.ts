import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./db/migrate";

// PARSE_DB_PATH lets the MCP server (launched with an unknown cwd) point at the
// real DB; the Next app falls back to <cwd>/data/parse.db.
const DB_PATH = process.env.PARSE_DB_PATH || path.join(process.cwd(), "data", "parse.db");
const DB_DIR = path.dirname(DB_PATH);

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
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
