import Database from "better-sqlite3";
import { useConnection } from "../db";
import { runMigrations } from "../db/migrate";
import type { DbBackend, BlobStore } from "./backend";
import type { SessionKey } from "./crypto";

// Whole-DB envelope backend (Model B). The ledger lives at rest as a single
// AES-256-GCM blob in the BlobStore; on open() it is decrypted into an in-memory
// SQLite connection that all queries run against; on persist() the DB is
// serialised and re-encrypted back to the blob. Plaintext never touches disk.
//
// open() also routes getDb() at this connection (useConnection), so SqliteRepo's
// delegated lib/db/* functions operate on the decrypted DB transparently.
//
// Phase-3 note: runMigrations() reads .sql files from the filesystem, which works
// in Node (self-hosted) but not in a Worker — the hosted target will need the
// migrations bundled as strings. Tracked as a Phase 2-3 task.
export class EncryptedBlobBackend implements DbBackend {
  private db: Database.Database | null = null;

  constructor(
    private store: BlobStore,
    private session: SessionKey
  ) {}

  async open(): Promise<Database.Database> {
    if (this.db) return this.db;

    const blob = await this.store.get();
    const db = blob
      ? new Database(Buffer.from(await this.session.open(blob))) // decrypt → in-memory DB
      : new Database(); // first run: fresh in-memory DB

    db.pragma("foreign_keys = ON");
    runMigrations(db); // idempotent: builds schema on first run, no-op thereafter

    useConnection(db);
    this.db = db;
    return db;
  }

  async persist(db: Database.Database): Promise<void> {
    const sealed = await this.session.seal(new Uint8Array(db.serialize()));
    await this.store.put(sealed);
  }

  async close(): Promise<void> {
    useConnection(null);
    this.db?.close();
    this.db = null;
  }
}

// In-memory BlobStore for tests and ephemeral use. The hosted target swaps this
// for a Durable Object storage / R2 adapter implementing the same interface.
export class MemoryBlobStore implements BlobStore {
  private bytes: Uint8Array | null = null;
  async get(): Promise<Uint8Array | null> {
    return this.bytes;
  }
  async put(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes;
  }
}
