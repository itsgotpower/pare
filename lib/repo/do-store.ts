// The whole-DB blob store for the Durable-Object-per-user backend, split out
// from do-backend.ts so it carries NO better-sqlite3 dependency and can be
// bundled into a Cloudflare Worker / Durable Object (where native modules can't
// load). do-backend.ts re-exports everything here, so callers still import from
// "./do-backend".
//
// DoBackend reads/writes one opaque blob (the serialised SQLite DB) through the
// DurableStore interface, the same way EncryptedBlobBackend talks to a BlobStore.
// The production implementation (DurableObjectStore) is backed by a Durable
// Object's storage; tests use MemoryDurableStore.

// Returns null when no DB exists yet (first access — DoBackend.open() then
// bootstraps a fresh schema via migrations).
export interface DurableStore {
  get(): Promise<Uint8Array | null>;
  put(bytes: Uint8Array): Promise<void>;
}

// The minimal slice of Cloudflare's DurableObjectStorage surface we use,
// declared structurally so this file needs no @cloudflare/workers-types at build
// time and tests can supply a stand-in. The real DO passes `ctx.storage`.
export interface DurableStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

export const CHUNK_BYTES = 96 * 1024; // under the 128 KiB DO per-value limit
const KEY_PREFIX = "db";
const COUNT_KEY = "db:chunks";

// Persists the whole-DB blob in a Durable Object's key-value storage. DO storage
// caps each value at 128 KiB, so a serialised DB larger than one chunk is split
// across `${KEY_PREFIX}:0..n-1` keys with a count sentinel; get() rehydrates them
// in order. The DO instance boundary is the per-user isolation, so this stores
// plaintext bytes (no envelope crypto here) and has zero auth knowledge.
export class DurableObjectStore implements DurableStore {
  constructor(private storage: DurableStorageLike) {}

  async get(): Promise<Uint8Array | null> {
    const count = (await this.storage.get<number>(COUNT_KEY)) ?? 0;
    if (count === 0) return null;

    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const chunk = await this.storage.get<ArrayBuffer | Uint8Array>(`${KEY_PREFIX}:${i}`);
      if (!chunk) throw new Error(`DurableObjectStore: missing chunk ${i}/${count}`);
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      parts.push(bytes);
      total += bytes.byteLength;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  async put(bytes: Uint8Array): Promise<void> {
    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));

    // Drop any chunks left over from a previously larger DB before writing.
    const stale = await this.storage.list<unknown>({ prefix: `${KEY_PREFIX}:` });
    for (const key of stale.keys()) {
      if (key === COUNT_KEY) continue;
      await this.storage.delete(key);
    }

    for (let i = 0; i < chunkCount; i++) {
      const slice = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      // Copy out of the larger buffer so we persist exactly this chunk's bytes.
      await this.storage.put(`${KEY_PREFIX}:${i}`, new Uint8Array(slice));
    }
    await this.storage.put(COUNT_KEY, chunkCount);
  }
}

// In-memory DurableStore for tests and ephemeral use — mirrors MemoryBlobStore.
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
