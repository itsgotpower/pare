import type Database from "better-sqlite3";

// A DbBackend owns one SQLite connection's lifecycle and durability — the Repo
// above it never knows where the bytes at rest live.
//
// Implementations:
//
//  - FileBackend: opens data/pare.db directly, exactly like today's getDb()
//    singleton. SQLite's WAL handles durability, so persist() is a no-op —
//    local/self-host + MCP behaviour is unchanged.
//
//  - DoBackend (do-backend.ts): whole-DB blob in a DurableStore, opened into an
//    in-memory connection, serialised back on persist(). Superseded on the
//    hosted target by DoSqlBackend (its own seam over the DO's native SQLite);
//    kept as Node-runnable test scaffolding for the Repo contract tests.
export interface DbBackend {
  // Return a ready connection: pragmas set, migrations applied. The Repo caches
  // the result for the life of the request/session.
  open(): Promise<Database.Database>;

  // Durably persist the current DB state. No-op for a live file connection;
  // for the encrypted backend this is serialise → encrypt → write-blob, so the
  // Repo calls it after each write (see batching note in SqliteRepo).
  persist(db: Database.Database): Promise<void>;

  // Release the connection.
  close(): Promise<void>;
}
