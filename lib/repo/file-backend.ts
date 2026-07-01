import type Database from "better-sqlite3";
import { getDb } from "../db";
import type { DbBackend } from "./backend";

// Local/self-host + MCP backend: the existing better-sqlite3 file singleton
// (data/pare.db). SQLite's WAL handles durability, so persist() is a no-op and
// behaviour is byte-for-byte identical to the pre-Repo getDb() singleton. The
// connection lives for the process lifetime, so close() is a no-op too.
export class FileBackend implements DbBackend {
  async open(): Promise<Database.Database> {
    return getDb();
  }

  async persist(_db: Database.Database): Promise<void> {
    // No-op: the file connection is live and SQLite persists writes itself.
  }

  async close(): Promise<void> {
    // No-op: the singleton is shared across requests for the process lifetime.
  }
}
