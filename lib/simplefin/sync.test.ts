// runSimplefinSync over an in-memory repo (DoBackend + MemoryDurableStore, the
// manual-txns.test.ts pattern) with a mocked bridge. The mock is deliberately
// ADVERSARIAL in the ways the live demo bridge proved real: transaction ids
// change on every request, and (worst case) date-window params are ignored so
// every backfill window returns the full history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "../repo/sqlite-repo";
import { DoBackend, MemoryDurableStore } from "../repo/do-backend";
import { runSimplefinSync } from "./sync";
import type { SimplefinConfigStore } from "./config-store";
import type { SimplefinConfig } from "../db/simplefin-config";

const ACCESS_URL = "https://user:pass@bridge.test/simplefin";
const T = Math.floor(Date.parse("2026-03-05T12:00:00Z") / 1000);
const DAY = 86400;

function freshRepo() {
  return new SqliteRepo(new DoBackend(new MemoryDurableStore()));
}

function memoryStore(initial: SimplefinConfig | null): SimplefinConfigStore & {
  current: SimplefinConfig | null;
} {
  const store = {
    current: initial,
    async load() {
      // Deep-copy so the core's in-place mutations don't leak between syncs.
      return store.current ? (JSON.parse(JSON.stringify(store.current)) as SimplefinConfig) : null;
    },
    async save(config: SimplefinConfig) {
      store.current = JSON.parse(JSON.stringify(config));
    },
    async clear() {
      store.current = null;
    },
  };
  return store;
}

function baseConfig(): SimplefinConfig {
  return {
    accessUrl: ACCESS_URL,
    autoSync: true,
    accounts: {
      "acct-1": { name: "Everyday Chequing", kind: "chequing", enabled: true },
      "acct-2": { name: "Cashback Card", kind: "card", enabled: true },
    },
  };
}

// A bridge whose txn ids shift every request (like the live demo) and which,
// when `ignoreWindows` is set, returns the full history for ANY window.
function fakeBridge(opts: { ignoreWindows?: boolean } = {}) {
  let requestCount = 0;
  const calls: URL[] = [];

  const rows = [
    { posted: T - 5 * DAY, amount: "-45.58", description: "Grocery store" },
    { posted: T - 4 * DAY, amount: "1200.00", description: "PAYROLL DEP" },
    // Genuine same-day, same-amount duplicate pair — must BOTH survive.
    { posted: T - 3 * DAY, amount: "-5.25", description: "Coffee" },
    { posted: T - 3 * DAY, amount: "-5.25", description: "Coffee" },
    { posted: T - 200 * DAY, amount: "-99.00", description: "Old charge" },
  ];

  const fetchImpl = (async (url: RequestInfo | URL) => {
    requestCount++;
    const u = new URL(String(url));
    calls.push(u);
    const start = Number(u.searchParams.get("start-date") ?? 0);
    const end = Number(u.searchParams.get("end-date") ?? Number.MAX_SAFE_INTEGER);
    const inWindow = (posted: number) =>
      opts.ignoreWindows || (posted >= start && posted <= end);

    const txns = rows
      .filter((r) => inWindow(r.posted))
      // ids derived from the REQUEST count — unstable across fetches, exactly
      // like the live demo bridge.
      .map((r, i) => ({ ...r, id: `req${requestCount}-txn${i}` }));

    return Response.json({
      errors: [],
      accounts: [
        {
          id: "acct-1",
          name: "Everyday Chequing",
          currency: "CAD",
          balance: "2451.19",
          "balance-date": T,
          transactions: txns,
        },
        {
          id: "acct-2",
          name: "Cashback Card",
          currency: "CAD",
          balance: "-512.30",
          "balance-date": T,
          transactions: [
            { ...rows[0], id: `req${requestCount}-card0` },
          ].filter((r) => inWindow(r.posted)),
        },
      ],
    });
  }) as typeof fetch;

  return { fetchImpl, calls, get requestCount() { return requestCount; } };
}

async function countRows(repo: SqliteRepo, source?: string): Promise<number> {
  const { total } = await repo.transactions.list({ source, limit: 1 });
  return total;
}

// Pin the clock a day after the newest fixture row so windows are
// deterministic and the incremental re-sync genuinely overlaps the backfill.
const NOW = () => new Date((T + DAY) * 1000);

test("first sync backfills; re-syncs are idempotent under request-unstable ids", async () => {
  const repo = freshRepo();
  const store = memoryStore(baseConfig());
  const bridge = fakeBridge();

  const first = await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl, now: NOW });
  assert.equal(first.kind, "ok");
  if (first.kind !== "ok") return;
  // 5 chequing rows (incl. BOTH coffee duplicates) + 1 card row.
  assert.equal(first.inserted, 6);
  assert.equal(await countRows(repo), 6);
  // Backfill = 4 disjoint 90-day windows.
  assert.equal(bridge.requestCount, 4);

  // Manual re-sync: the incremental window (watermark − 7d) re-fetches the
  // recent rows with SHIFTED ids; every one must dedup, none may duplicate.
  const second = await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl, now: NOW });
  assert.equal(second.kind, "ok");
  if (second.kind !== "ok") return;
  assert.equal(second.inserted, 0);
  assert.ok(second.skipped >= 4); // grocery, payroll, both coffees re-fetched
  assert.equal(await countRows(repo), 6);
});

test("backfill survives a bridge that ignores date windows (no multiplication)", async () => {
  const repo = freshRepo();
  const store = memoryStore(baseConfig());
  const bridge = fakeBridge({ ignoreWindows: true });

  const result = await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl, now: NOW });
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  // Every window returned the FULL history with fresh ids; the max-per-window
  // content merge must still land exactly one copy of each row — including
  // exactly TWO coffees (the genuine duplicate pair), not eight.
  assert.equal(result.inserted, 6);
  assert.equal(await countRows(repo), 6);
});

test("auto sync respects the watermark and the attempt cooldown", async () => {
  const repo = freshRepo();
  const config = baseConfig();
  config.lastSyncedAt = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2h ago
  const store = memoryStore(config);
  const bridge = fakeBridge();

  const result = await runSimplefinSync(repo, store, {
    auto: true,
    fetchImpl: bridge.fetchImpl,
  });
  assert.equal(result.kind, "skipped");
  assert.equal(bridge.requestCount, 0);

  // autoSync off blocks even a stale watermark.
  store.current!.lastSyncedAt = new Date(Date.now() - 48 * 3600_000).toISOString();
  store.current!.autoSync = false;
  const off = await runSimplefinSync(repo, store, { auto: true, fetchImpl: bridge.fetchImpl });
  assert.equal(off.kind, "skipped");

  // Manual sync ignores both gates.
  store.current!.autoSync = true;
  store.current!.lastSyncedAt = new Date().toISOString();
  const manual = await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl });
  assert.equal(manual.kind, "ok");
});

test("account gate blocks NEW sources with a PLAN CAP notice; existing always re-sync", async () => {
  const repo = freshRepo();
  const store = memoryStore(baseConfig());
  const bridge = fakeBridge();

  // Gate allowing exactly one account (Free-plan shape).
  const gate = (newSource: string, existing: readonly string[]) =>
    existing.length >= 1
      ? { allowed: false, reason: "Free plan includes 1 account. Upgrade for more." }
      : { allowed: true };

  const first = await runSimplefinSync(repo, store, {
    fetchImpl: bridge.fetchImpl,
    accountGate: gate,
    now: NOW,
  });
  assert.equal(first.kind, "ok");
  if (first.kind !== "ok") return;
  // Alphabetical among new accounts: "Cashback Card" wins the single slot.
  assert.ok(first.errors.some((e) => e.startsWith("PLAN CAP: Everyday Chequing")));
  assert.equal(await countRows(repo, "simplefin_acct2"), 1);
  assert.equal(await countRows(repo, "simplefin_acct1"), 0);

  // The admitted account keeps re-syncing under the same gate.
  const second = await runSimplefinSync(repo, store, {
    fetchImpl: bridge.fetchImpl,
    accountGate: gate,
    now: NOW,
  });
  assert.equal(second.kind, "ok");
  if (second.kind !== "ok") return;
  assert.ok(second.errors.some((e) => e.startsWith("PLAN CAP: Everyday Chequing")));
  assert.equal(await countRows(repo, "simplefin_acct2"), 1);
});

test("fetch failure records the error and reports fetch_error", async () => {
  const repo = freshRepo();
  const store = memoryStore(baseConfig());
  const failingFetch = (async () => new Response("", { status: 500 })) as typeof fetch;

  const result = await runSimplefinSync(repo, store, { fetchImpl: failingFetch });
  assert.equal(result.kind, "fetch_error");
  assert.match(store.current!.lastSyncStatus!, /HTTP 500/);
  assert.ok(store.current!.lastAttemptAt);
  assert.equal(store.current!.lastSyncedAt, undefined);
});

test("statement balance anchor UPSERTs in place across syncs", async () => {
  const repo = freshRepo();
  const store = memoryStore(baseConfig());
  const bridge = fakeBridge();

  await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl, now: NOW });
  await runSimplefinSync(repo, store, { fetchImpl: bridge.fetchImpl, now: NOW });

  const statements = await repo.statements.list();
  const sfin = statements.filter((s) => s.source.startsWith("simplefin_"));
  // One row per account, not one per sync.
  assert.equal(sfin.length, 2);
  const chq = sfin.find((s) => s.source === "simplefin_acct1")!;
  assert.equal(chq.closing_balance, 2451.19);
});
