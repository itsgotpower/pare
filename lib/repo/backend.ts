import type Database from "better-sqlite3";

// A DbBackend owns one SQLite connection's lifecycle and durability. It is the
// seam where whole-DB envelope encryption (Model B) lives — the Repo above it
// never knows whether bytes at rest are plaintext or ciphertext.
//
// Two implementations:
//
//  - FileBackend (Step 2): opens data/parse.db directly, exactly like today's
//    getDb() singleton. SQLite's WAL handles durability, so persist() is a
//    no-op — local/self-host + MCP behaviour is unchanged.
//
//  - EncryptedBlobBackend (Step 3 / wired in Phase 2-3): reads a whole-DB
//    ciphertext blob, decrypts it into an in-memory connection
//    (`new Database(buffer)`), and on persist() serialises (`db.serialize()`) +
//    AEAD-encrypts the DB back to the BlobStore. Plaintext never touches disk;
//    at rest the user's ledger is ciphertext under their own key.
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

// Where an EncryptedBlobBackend reads/writes the whole-DB ciphertext blob.
// LocalFileBlobStore for self-hosted-encrypted; a Durable Object storage / R2
// adapter for the hosted target. Returns null when no DB exists yet (first run).
export interface BlobStore {
  get(): Promise<Uint8Array | null>;
  put(bytes: Uint8Array): Promise<void>;
}
