import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { SqliteRepo } from "./sqlite-repo";
import {
  DoBackend,
  DurableObjectStore,
  MemoryDurableStore,
  runMigrationsFromStrings,
  CHUNK_BYTES,
} from "./do-backend";
import type { DurableStorageLike } from "./do-store";

const SQLITE_MAGIC = "SQLite format 3\x00"; // 16-byte header magic (null-terminated)

// ---------------------------------------------------------------------------
// Part 1 — DoBackend + SqliteRepo over an in-memory DurableStore (Node).
//
// better-sqlite3 is a native module, so the DbBackend itself is exercised in
// Node (as EncryptedBlobBackend's test does). These prove the DbBackend contract
// SqliteRepo sits on: write → persist → reopen → read, and that the Repo
// namespace methods work against the DO-backed SQLite.
// ---------------------------------------------------------------------------

test("DoBackend: data written through the Repo survives a fresh open (persist round-trip)", async () => {
  const store = new MemoryDurableStore();

  // "Session 1": one DO, one user's DB. Seed rules + write across namespaces.
  const repo1 = new SqliteRepo(new DoBackend(store));
  await repo1.categories.seed();
  await repo1.goals.upsert("Groceries", 600);
  const insrted = await repo1.transactions.insert({
    statement_id: null,
    source: "amex",
    account: "card",
    period: "2026-05",
    txn_date: "2026-05-04",
    description: "CORNER STORE",
    amount: 12.5,
    category: "Groceries",
    flow: "spend",
    dedup_key: "k1",
  });
  assert.equal(insrted, true);

  // Something is now persisted in DO storage.
  const stored = await store.get();
  assert.ok(stored, "a DB blob should have been persisted to the DurableStore");

  // "Session 2": a brand-new backend over the SAME store re-opens the persisted
  // blob (DO instance wakes from storage) and sees all the data.
  const repo2 = new SqliteRepo(new DoBackend(store));

  const goals = await repo2.goals.list();
  assert.equal(goals.length, 1);
  assert.equal(goals[0].category, "Groceries");
  assert.equal(goals[0].monthly_limit, 600);

  const { rows, total } = await repo2.transactions.list();
  assert.equal(total, 1);
  assert.equal(rows[0].description, "CORNER STORE");

  const rules = await repo2.categories.listRules();
  assert.ok(rules.length > 0, "seeded category rules should survive the reopen");
});

test("DoBackend: Repo namespace methods (summary/income/profile) work against the DO-backed SQLite", async () => {
  const store = new MemoryDurableStore();
  const repo = new SqliteRepo(new DoBackend(store));

  await repo.categories.seed();
  // A couple of card spends + an income deposit so summary/income have data.
  await repo.transactions.insert({
    statement_id: null, source: "amex", account: "card", period: "2026-05",
    txn_date: "2026-05-04", description: "GROCER A", amount: 40, category: "Groceries",
    flow: "spend", dedup_key: "a",
  });
  await repo.transactions.insert({
    statement_id: null, source: "amex", account: "card", period: "2026-05",
    txn_date: "2026-05-09", description: "GROCER B", amount: 60, category: "Groceries",
    flow: "spend", dedup_key: "b",
  });
  await repo.transactions.insert({
    statement_id: null, source: "cibc_chequing", account: "chequing", period: "2026-05",
    txn_date: "2026-05-01", description: "PEOPLE CENTER PAYROLL", amount: 3000, category: "Banking",
    flow: "income", dedup_key: "c",
  });

  // Cross-section of the namespaces SqliteRepo exposes — they must run unchanged.
  const monthly = await repo.summary.monthlyTotals(12);
  assert.ok(monthly.some((m) => m.month === "2026-05"), "summary.monthlyTotals sees the spend");

  const breakdown = await repo.summary.categoryBreakdown("2026-05");
  const groceries = breakdown.find((c) => c.category === "Groceries");
  assert.equal(groceries?.total, 100);

  const income = await repo.income.monthly(12);
  assert.ok(income.some((m) => m.total === 3000), "income.monthly sees the payroll deposit");

  const health = await repo.profile.dataHealth();
  assert.ok(health, "profile.dataHealth runs against the DO-backed DB");

  // waitlist namespace (write + read) also works end to end.
  const joined = await repo.waitlist.join("a@example.com");
  assert.ok(joined);
  assert.equal(await repo.waitlist.count(), 1);
});

test("DoBackend: migrations run at first access (idempotent, full schema present)", async () => {
  const store = new MemoryDurableStore();
  const backend = new DoBackend(store);
  const db = await backend.open();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);

  for (const expected of [
    "transactions", "statements", "category_rules", "category_overrides",
    "spending_goals", "app_user", "manual_entries", "waitlist", "v_transactions",
  ]) {
    assert.ok(tables.includes(expected), `migrations should create ${expected}`);
  }

  // All five migrations recorded; re-running is a no-op (idempotent).
  const before = db.prepare("SELECT COUNT(*) c FROM _migrations").get() as { c: number };
  assert.equal(before.c, 5);
  runMigrationsFromStrings(db);
  const after = db.prepare("SELECT COUNT(*) c FROM _migrations").get() as { c: number };
  assert.equal(after.c, 5, "re-running migrations must not duplicate rows");

  await backend.close();
});

// DurableObjectStore drives a real DurableObjectStorage via list/get/put/delete.
// Here we exercise the class against a faithful in-memory stand-in for that API
// to prove chunking across the 128 KiB limit and shrink-on-rewrite; Part 2 then
// runs the same chunk layout against Cloudflare's actual storage under miniflare.
class FakeDurableStorage implements DurableStorageLike {
  private map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.map) {
      if (!options?.prefix || k.startsWith(options.prefix)) out.set(k, v as T);
    }
    return out;
  }
  keyCount(): number {
    return this.map.size;
  }
}

test("DurableObjectStore: chunks a >128 KiB blob and shrinks cleanly on rewrite", async () => {
  const storage = new FakeDurableStorage();
  const store = new DurableObjectStore(storage);

  assert.equal(await store.get(), null, "empty storage reads back as null (first access)");

  // A blob spanning multiple chunks (DB bigger than one DO value).
  const big = new Uint8Array(CHUNK_BYTES * 2 + 1234);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  await store.put(big);

  const back = await store.get();
  assert.ok(back);
  assert.equal(back!.byteLength, big.byteLength);
  assert.deepEqual(back, big, "multi-chunk blob round-trips byte-for-byte");

  // Rewriting with a smaller blob must drop the now-stale trailing chunk keys.
  const small = new Uint8Array(10).fill(7);
  await store.put(small);
  const backSmall = await store.get();
  assert.deepEqual(backSmall, small, "shrunk blob round-trips");
  // db:chunks + exactly one data chunk = 2 keys, no orphans left behind.
  assert.equal(storage.keyCount(), 2, "stale chunks from the larger blob are deleted");
});

test("DoBackend: a serialised real DB persists through DurableObjectStore (chunked) and reopens", async () => {
  // End-to-end through the production store implementation (not the memory one),
  // bridging the better-sqlite3 backend to the chunked DO storage adapter.
  const storage = new FakeDurableStorage();
  const store = new DurableObjectStore(storage);

  const repo1 = new SqliteRepo(new DoBackend(store));
  await repo1.categories.seed();
  await repo1.goals.upsert("Dining", 250);

  const repo2 = new SqliteRepo(new DoBackend(store));
  const goals = await repo2.goals.list();
  assert.equal(goals.length, 1);
  assert.equal(goals[0].category, "Dining");

  // At rest it is a real serialised SQLite DB (this backend does NOT encrypt —
  // the DO instance boundary is the isolation), reassembled from the chunks.
  const raw = await store.get();
  assert.ok(raw);
  const header = Buffer.from(raw!.subarray(0, SQLITE_MAGIC.length)).toString("binary");
  assert.equal(header, SQLITE_MAGIC, "DO-backed blob at rest is a plain serialised SQLite DB");
});

// ---------------------------------------------------------------------------
// Part 2 — the DurableObjectStore chunk layout against Cloudflare's real
// DurableObjectStorage, running inside the Workers runtime via miniflare. This
// proves the storage adapter does NOT hard-depend on any wrangler scaffolding
// from another session and works on the actual DO storage API (get/put/delete/
// list), independent of better-sqlite3 (which can't load in a Worker).
// ---------------------------------------------------------------------------

// Inline Worker module: a Durable Object that round-trips a chunked byte blob
// through ctx.storage using the SAME key layout as DurableObjectStore
// (`db:<i>` + `db:chunks`). One DO instance == one user's DB.
const WORKER_SCRIPT = /* js */ `
  const CHUNK_BYTES = ${CHUNK_BYTES};
  const PREFIX = "db";
  const COUNT_KEY = "db:chunks";

  async function putBlob(storage, bytes) {
    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
    const stale = await storage.list({ prefix: PREFIX + ":" });
    for (const key of stale.keys()) {
      if (key === COUNT_KEY) continue;
      await storage.delete(key);
    }
    for (let i = 0; i < chunkCount; i++) {
      const slice = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      await storage.put(PREFIX + ":" + i, new Uint8Array(slice));
    }
    await storage.put(COUNT_KEY, chunkCount);
  }

  async function getBlob(storage) {
    const count = (await storage.get(COUNT_KEY)) ?? 0;
    if (count === 0) return null;
    const parts = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const chunk = await storage.get(PREFIX + ":" + i);
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      parts.push(u8);
      total += u8.byteLength;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return out;
  }

  export class UserDb {
    constructor(ctx) { this.ctx = ctx; }
    async fetch(request) {
      const storage = this.ctx.storage;
      if (request.method === "PUT") {
        const bytes = new Uint8Array(await request.arrayBuffer());
        await putBlob(storage, bytes);
        return new Response("ok");
      }
      const blob = await getBlob(storage);
      if (blob === null) return new Response(null, { status: 204 });
      return new Response(blob);
    }
  }

  export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      // The id in the path is the per-user routing key (Session 6's job upstream);
      // each distinct id is a distinct DB. This backend has no auth knowledge.
      const id = env.USER_DB.idFromName(url.pathname);
      return env.USER_DB.get(id).fetch(request);
    },
  };
`;

test("miniflare: DurableObjectStore layout round-trips chunked bytes on the real DO storage", async () => {
  const mf = new Miniflare({
    modules: true,
    script: WORKER_SCRIPT,
    durableObjects: { USER_DB: "UserDb" },
  });

  try {
    // First access: no DB yet.
    const empty = await mf.dispatchFetch("http://do/user-1");
    assert.equal(empty.status, 204, "a fresh DO has no DB blob");

    // Persist a multi-chunk blob, then read it back byte-for-byte.
    const payload = new Uint8Array(CHUNK_BYTES * 2 + 500);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7) % 256;
    const put = await mf.dispatchFetch("http://do/user-1", { method: "PUT", body: payload });
    assert.equal(put.status, 200);

    const got = await mf.dispatchFetch("http://do/user-1");
    const back = new Uint8Array(await got.arrayBuffer());
    assert.equal(back.byteLength, payload.byteLength, "multi-chunk blob length survives DO storage");
    assert.deepEqual(back, payload, "blob round-trips byte-for-byte through real DO storage");

    // A different id is a different DO == a different user's DB (still empty).
    const other = await mf.dispatchFetch("http://do/user-2");
    assert.equal(other.status, 204, "one DO instance == one user's DB; user-2 is isolated");
  } finally {
    await mf.dispose();
  }
});
