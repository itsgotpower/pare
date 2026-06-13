import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

// ============================================================================
// PHASE 2 EXIT CRITERION — "two test users see fully disjoint data."
// ============================================================================
//
// This is the convergence gate. It drives the FULL hosted request path:
//
//   bearer token  -> resolveUser(request, hostedAuth)  -> userId
//   userId        -> that user's Repo (their own Durable Object)
//   route reads   -> summary / transactions / networth scoped to that Repo
//
// and asserts user A's responses contain NONE of user B's rows and vice versa.
//
// What is real vs. stubbed (and why that still proves isolation):
//   - Auth is the REAL better-auth instance over a D1 shim (same as
//     lib/auth/resolve.test.ts). Two real registrations -> two real bearer
//     tokens -> resolveUserHosted resolves each to its own userId.
//   - Routing is the REAL contract: getRepoForUser derives a DO from the userId
//     and returns a DoRepoClient over it. Here, instead of a Worker DO, each
//     userId gets its OWN SqliteRepo over a DoBackend over its OWN
//     MemoryDurableStore — dispatched through the SAME repo-rpc envelope
//     (callRepoMethod) the real UserDataObject runs. Distinct userId -> distinct
//     store -> distinct SQLite DB. Isolation is BY CONSTRUCTION: there is no
//     query that can reach across stores, exactly as on real DOs.
//   - The DO storage layout itself is separately proven on Cloudflare's real DO
//     storage under miniflare (do-backend.test.ts, Part 2).

process.env.PARSE_DEPLOY_TARGET = "hosted";
process.env.BETTER_AUTH_SECRET ||= "test-secret-please-only-for-tests-000000";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
process.env.PARSE_DB_PATH ||= path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "parse-isolation-test-")),
  "parse.db"
);

import { createHostedAuth, type HostedAuth, type D1Like } from "../auth/hosted";
import { resolveUser } from "../auth/resolve";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend } from "./do-backend";
import { MemoryDurableStore } from "./do-store";
import { DoRepoClient } from "./do-repo-client";
import { callRepoMethod } from "./repo-rpc";
import type { Repo, NewTransaction } from "./types";

// --- D1 shim (same one the dev path / resolve.test.ts use) -----------------
function makeD1Shim(db: Database.Database): D1Like {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...args: unknown[]) {
        params = args;
        return api;
      },
      async all() {
        const results = stmt.reader ? stmt.all(...params) : [];
        if (!stmt.reader) stmt.run(...params);
        return { results, success: true, meta: {} };
      },
      async run() {
        const info = stmt.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        };
      },
      async first(col?: string) {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? (row[col] ?? null) : row;
      },
      async raw() {
        return stmt.reader ? (stmt.raw().all(...params) as unknown[]) : [];
      },
    };
    return api;
  };
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Like;
}

// --- Per-user DO registry (stands in for USER_DATA.idFromName(userId)) ------
//
// One SqliteRepo over one DoBackend over one MemoryDurableStore PER userId.
// idFromName is deterministic, so a userId always maps to the same store — its
// database — and never to another user's. This is the in-process equivalent of
// getRepoForUser() in lib/repo/index.ts.
const stores = new Map<string, Repo>();
function doRepoForUser(userId: string): Repo {
  let backendRepo = stores.get(userId);
  if (!backendRepo) {
    backendRepo = new SqliteRepo(new DoBackend(new MemoryDurableStore()));
    stores.set(userId, backendRepo);
  }
  // The request side never holds the SqliteRepo directly — it talks through the
  // SAME envelope transport the real DO uses (callRepoMethod). This is exactly
  // what production does, minus the Worker hop.
  return new DoRepoClient((call) => callRepoMethod(backendRepo!, call));
}

// The production getScopedRepo() flow, inlined for the test (Worker bindings
// aren't available here): resolve the caller, then route to their DO repo.
async function scopedRepoFor(request: Request, auth: HostedAuth): Promise<Repo | null> {
  const resolved = await resolveUser(request, auth);
  if (!resolved) return null;
  return doRepoForUser(resolved.userId);
}

function bearerRequest(token: string): Request {
  return new Request("http://localhost/api/summary", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function tx(over: Partial<NewTransaction> & { dedup_key: string }): NewTransaction {
  return {
    statement_id: null,
    source: "amex",
    account: "card",
    period: "2026-05",
    txn_date: "2026-05-10",
    description: "MERCHANT",
    amount: 10,
    category: "Groceries",
    flow: "spend",
    ...over,
  };
}

let auth: HostedAuth;
let tokenA = "";
let tokenB = "";
let userIdA = "";
let userIdB = "";

before(async () => {
  const db = new Database(":memory:");
  db.exec(
    fs.readFileSync(path.join(process.cwd(), "d1/migrations/0001_better_auth.sql"), "utf-8")
  );
  auth = createHostedAuth(makeD1Shim(db));

  const a = await auth.api.signUpEmail({
    body: { email: "alice@example.com", password: "alice-password-123", name: "Alice" },
    returnHeaders: true,
  });
  userIdA = a.response.user.id;
  tokenA = a.headers.get("set-auth-token")!;

  const b = await auth.api.signUpEmail({
    body: { email: "bob@example.com", password: "bob-password-456", name: "Bob" },
    returnHeaders: true,
  });
  userIdB = b.response.user.id;
  tokenB = b.headers.get("set-auth-token")!;

  assert.ok(tokenA && tokenB, "both users got bearer tokens");
  assert.notEqual(userIdA, userIdB, "two distinct users");
});

test("two users, two bearer tokens -> fully disjoint data through the scoped Repo", async () => {
  // --- Each user seeds + writes DIFFERENT data through THEIR scoped repo. -----
  const repoA = (await scopedRepoFor(bearerRequest(tokenA), auth))!;
  const repoB = (await scopedRepoFor(bearerRequest(tokenB), auth))!;
  assert.ok(repoA && repoB, "both tokens resolve to a scoped repo");

  await repoA.categories.seed();
  await repoB.categories.seed();

  // Alice: groceries + dining spend + a payroll deposit + a net-worth asset.
  // Inserted via insertMany under a batch() boundary — the SAME single-persist
  // path the upload route uses, forwarded through the DoRepoClient transport.
  await repoA.batch(async () => {
    await repoA.transactions.insertMany([
      tx({ dedup_key: "A1", description: "ALICE GROCER", amount: 40, category: "Groceries" }),
      tx({ dedup_key: "A2", description: "ALICE CAFE", amount: 12, category: "Dining" }),
      tx({
        dedup_key: "A3",
        source: "cibc_chequing",
        account: "chequing",
        description: "PEOPLE CENTER PAYROLL",
        amount: 5000,
        category: "Banking",
        flow: "income",
        txn_date: "2026-05-01",
      }),
    ]);
  });
  await repoA.netWorth.addEntry({
    name: "Alice TFSA",
    kind: "asset",
    amount: 25000,
    effective_date: "2026-05-01",
  });

  // Bob: a different card category, different amounts, a different asset.
  await repoB.batch(async () => {
    await repoB.transactions.insertMany([
      tx({ dedup_key: "B1", description: "BOB HARDWARE", amount: 999, category: "Home / hardware" }),
      tx({
        dedup_key: "B2",
        source: "cibc_chequing",
        account: "chequing",
        description: "PEOPLE CENTER PAYROLL",
        amount: 8000,
        category: "Banking",
        flow: "income",
        txn_date: "2026-05-01",
      }),
    ]);
  });
  await repoB.netWorth.addEntry({
    name: "Bob Brokerage",
    kind: "asset",
    amount: 70000,
    effective_date: "2026-05-01",
  });

  // --- Re-resolve from fresh requests (as a real second API call would). ------
  const aSummary = (await scopedRepoFor(bearerRequest(tokenA), auth))!;
  const bSummary = (await scopedRepoFor(bearerRequest(tokenB), auth))!;

  // transactions: A sees only A's rows, B only B's.
  const aTxns = await aSummary.transactions.list();
  const bTxns = await bSummary.transactions.list();
  const aDescr = aTxns.rows.map((r) => r.description);
  const bDescr = bTxns.rows.map((r) => r.description);

  assert.ok(aDescr.includes("ALICE GROCER"), "A sees her own row");
  assert.ok(aDescr.includes("ALICE CAFE"));
  assert.ok(!aDescr.includes("BOB HARDWARE"), "A does NOT see B's row");
  assert.ok(bDescr.includes("BOB HARDWARE"), "B sees his own row");
  assert.ok(!bDescr.some((d) => d.startsWith("ALICE")), "B does NOT see any of A's rows");

  // summary.categoryBreakdown: A's spend categories disjoint from B's.
  const aCats = (await aSummary.summary.categoryBreakdown("2026-05")).map((c) => c.category);
  const bCats = (await bSummary.summary.categoryBreakdown("2026-05")).map((c) => c.category);
  assert.ok(aCats.includes("Groceries") && aCats.includes("Dining"), "A's categories");
  assert.ok(!aCats.includes("Home / hardware"), "A has none of B's categories");
  assert.ok(bCats.includes("Home / hardware"), "B's category");
  assert.ok(!bCats.includes("Dining"), "B has none of A's categories");

  // income.monthly: each sees only their own payroll figure.
  const aIncome = (await aSummary.income.monthly()).reduce((s, m) => s + m.total, 0);
  const bIncome = (await bSummary.income.monthly()).reduce((s, m) => s + m.total, 0);
  assert.equal(aIncome, 5000, "A's income is hers alone (not 5000+8000)");
  assert.equal(bIncome, 8000, "B's income is his alone");

  // networth: each sees only their own entry.
  const aNet = await aSummary.netWorth.listEntries();
  const bNet = await bSummary.netWorth.listEntries();
  assert.deepEqual(
    aNet.map((e) => e.name),
    ["Alice TFSA"],
    "A's net-worth entries are hers alone"
  );
  assert.deepEqual(
    bNet.map((e) => e.name),
    ["Bob Brokerage"],
    "B's net-worth entries are his alone"
  );

  // net_worth aggregate totals reflect only the owner's asset.
  const aNw = await aSummary.netWorth.get();
  const bNw = await bSummary.netWorth.get();
  assert.equal(aNw.current?.assets, 25000, "A's net worth reflects only her TFSA");
  assert.equal(bNw.current?.assets, 70000, "B's net worth reflects only his brokerage");
  assert.notEqual(aNw.current?.net, bNw.current?.net, "different net worth per user");
});

test("an unauthenticated (no/invalid bearer) request in hosted mode resolves to null -> 401", async () => {
  const anon = await scopedRepoFor(new Request("http://localhost/api/summary"), auth);
  assert.equal(anon, null, "no credential -> null (route returns 401)");

  const bad = await scopedRepoFor(
    new Request("http://localhost/api/summary", {
      headers: { authorization: "Bearer not-a-real-token" },
    }),
    auth
  );
  assert.equal(bad, null, "invalid bearer -> null (route returns 401)");
});
