// The whole-DB blob store for the blob-based DoBackend, split out from
// do-backend.ts so it carries NO better-sqlite3 dependency. The blob path is no
// longer on the hosted target (superseded by DoSqlBackend over the DO's native
// SQLite); DoBackend + MemoryDurableStore remain as Node-runnable test
// scaffolding for the Repo contract tests (do-backend.test.ts,
// two-user-isolation.test.ts, do-repo-client-batch.test.ts).

// Returns null when no DB exists yet (first access — DoBackend.open() then
// bootstraps a fresh schema via migrations).
export interface DurableStore {
  get(): Promise<Uint8Array | null>;
  put(bytes: Uint8Array): Promise<void>;
}

// In-memory DurableStore for tests and ephemeral use.
export class MemoryDurableStore implements DurableStore {
  private bytes: Uint8Array | null = null;
  async get(): Promise<Uint8Array | null> {
    return this.bytes;
  }
  async put(bytes: Uint8Array): Promise<void> {
    // Copy so later mutations to the caller's buffer don't bleed into storage.
    this.bytes = new Uint8Array(bytes);
  }
}
