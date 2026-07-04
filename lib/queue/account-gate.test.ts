import { test } from "node:test";
import assert from "node:assert/strict";
import { handleParseMessage, type ConsumerDeps } from "./consumer";
import { jobStoreOverKv, type KvNamespaceLike } from "./job-store";
import type { PdfStore } from "../storage/pdf-store";
import type { ParserService, ParseResult } from "../parser/service";
import type { Repo } from "../repo/types";
import type { ParseJobMessage } from "./types";

// ---------------------------------------------------------------------------
// Consumer-side ACCOUNT-cap gate (message.planId → cloud/billing checkAccountLimit).
// Node-level tests with every ConsumerDeps faked; the pure cap decision itself is
// covered in cloud/billing/account-limit.test.ts — these prove the WIRING: a
// denial lands as a terminal `failed` job with the upgrade message, the PDF is
// dropped, and nothing is inserted; an allowed / ungated message inserts as usual.
// ---------------------------------------------------------------------------

function memKv(): KvNamespaceLike {
  const m = new Map<string, string>();
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async put(key, value) {
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
    async list() {
      return { keys: [...m.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
}

function fakePdfStore() {
  const deleted: string[] = [];
  const store: PdfStore = {
    async put(userId, filename) {
      return `u/${userId}/fake-${filename}`;
    },
    async get() {
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    },
    async delete(key) {
      deleted.push(key);
    },
  };
  return { store, deleted };
}

// A parser whose output's `source` is the account the statement belongs to.
function parserFor(source: string): ParserService {
  const result: ParseResult = {
    transactions: [
      {
        source,
        account: "1234",
        period: "2026-06",
        txn_date: "2026-06-15",
        description: "COFFEE SHOP",
        amount: 4.5,
        category: "Other / uncategorized",
        flow: "spend",
      },
    ],
    statements: [],
  };
  return { parse: async () => result };
}

// The minimal Repo slice handleParseMessage + insertParsedStatement touch.
function fakeRepo(existingSources: string[]) {
  const calls = { insertMany: 0 };
  const repo = {
    transactions: {
      sources: async () => existingSources,
      insertMany: async (txs: unknown[]) => {
        calls.insertMany++;
        return { inserted: txs.length, skipped: 0 };
      },
    },
    statements: { insert: async () => 1 },
    imports: { rowsInWindow: async () => [] },
    categories: { seed: async () => {}, recategorizeAll: async () => 0 },
    batch: <T,>(fn: () => Promise<T>) => fn(),
  } as unknown as Repo;
  return { repo, calls };
}

function depsFor(existingSources: string[], parsedSource: string) {
  const { store: pdfStore, deleted } = fakePdfStore();
  const jobStore = jobStoreOverKv(memKv());
  const { repo, calls } = fakeRepo(existingSources);
  const deps: ConsumerDeps = {
    pdfStore,
    parser: parserFor(parsedSource),
    jobStore,
    getRepoForUser: async () => repo,
  };
  return { deps, jobStore, deleted, calls };
}

async function run(
  planId: string | undefined,
  existingSources: string[],
  parsedSource: string
) {
  const ctx = depsFor(existingSources, parsedSource);
  await ctx.jobStore.create({ jobId: "j1", userId: "alice", filename: "s.pdf" });
  const message: ParseJobMessage = {
    userId: "alice",
    r2Key: "u/alice/fake-s.pdf",
    filename: "s.pdf",
    jobId: "j1",
    ...(planId ? { planId } : {}),
  };
  const result = await handleParseMessage(message, ctx.deps);
  const job = await ctx.jobStore.get("alice", "j1");
  return { result, job, ...ctx };
}

test("free plan + a NEW source over the cap → terminal failed with the upgrade message, PDF dropped, nothing inserted", async () => {
  const { result, job, deleted, calls } = await run("free", ["cibc_visa"], "amex");

  assert.deepEqual(result, { inserted: 0, skipped: 0 });
  assert.equal(job?.status, "failed", "a cap denial is PERMANENT — the client stops polling");
  assert.equal(job?.error, "Free plan includes 1 account. Upgrade for more.");
  assert.deepEqual(deleted, ["u/alice/fake-s.pdf"], "the staged PDF is dropped like any permanent outcome");
  assert.equal(calls.insertMany, 0, "no rows reach the user's repo");
});

test("free plan + a re-upload for the EXISTING source → parses and inserts normally", async () => {
  const { result, job, calls } = await run("free", ["cibc_visa"], "cibc_visa");

  assert.equal(job?.status, "done");
  assert.equal(result.inserted, 1);
  assert.equal(calls.insertMany, 1);
});

test("pro plan + a second account → allowed; manual cash rows don't count", async () => {
  const { job } = await run("pro", ["manual", "cibc_visa"], "amex");
  assert.equal(job?.status, "done");
});

test("no planId on the message (cloud off / self-host / email-in) → no account gating at all", async () => {
  const { result, job } = await run(undefined, ["cibc_visa"], "amex");

  assert.equal(job?.status, "done", "an ungated message inserts even for a new source");
  assert.equal(result.inserted, 1);
});
