import { describe, it, expect } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { SqliteRepo } from "../repo/sqlite-repo";
import { DoSqlBackend } from "../repo/do-sql-backend";
import { repoOverDoStub } from "../repo";
import { callRepoMethod, type AnyRepoCall } from "../repo/repo-rpc";
import type { Repo } from "../repo/types";
import type { DoStorageWithSql } from "../repo/do-sql-adapter";
import { pdfStoreOverBucket, type R2BucketLike, type PdfStore } from "../storage/pdf-store";
import { jobStoreOverKv, type KvNamespaceLike } from "./job-store";
import { handleParseMessage, type ConsumerDeps } from "./consumer";
import type { ParserService, ParseResult } from "../parser/service";
import type { ParseJobMessage } from "./types";

// ---------------------------------------------------------------------------
// P4 async parse pipeline — full producer->consumer round-trip, INSIDE workerd:
//   - a real per-user Durable Object (ctx.storage.sql) is the data store, so the
//     consumer's insert+recategorize batch runs against the SAME backend prod uses;
//   - miniflare R2 holds the PDF bytes (real PdfStore);
//   - miniflare KV holds the job-status records (real JobStore);
//   - the ParserService (container) is MOCKED — we assert the WIRING, not the
//     Python parser (which has its own suite + can't run on workerd).
//
// We prove: a message round-trips to rows in the CORRECT user's DO; user A's job
// never writes to user B (isolation); the PDF is deleted on success; a failing
// parse leaves the PDF AND marks the job failed (and rethrows so the Queue retries).
// ---------------------------------------------------------------------------

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_SQL: DurableObjectNamespace;
    PDF_BUCKET: R2BucketLike;
    PARSE_JOBS: KvNamespaceLike;
  }
}

// A per-user Repo over a REAL DO's native SQLite. Each userId gets its own DO
// instance (== its own isolated SQLite DB), mirroring production tenancy.
//
// workerd forbids touching one DO's storage I/O from another DO's context, so we
// must run EVERY repo operation inside runInDurableObject for that user's stub.
// We therefore cache the STUB per user and return a Repo (repoOverDoStub — the
// SAME request-side client production uses) whose transport dispatches each
// serialisable repo-rpc call inside the owning DO via callRepoMethod. The DO's
// ctx.storage is only ever accessed within its own runInDurableObject callback.
class PerUserDoRepos {
  private stubs = new Map<string, DurableObjectStub>();
  private counter = 0;

  private stubFor(userId: string): DurableObjectStub {
    let stub = this.stubs.get(userId);
    if (!stub) {
      const id = env.TEST_SQL.idFromName(`consumer-${userId}-${this.counter++}`);
      stub = env.TEST_SQL.get(id);
      this.stubs.set(userId, stub);
    }
    return stub;
  }

  async repoFor(userId: string): Promise<Repo> {
    const stub = this.stubFor(userId);
    return repoOverDoStub({
      call: (req: AnyRepoCall) =>
        runInDurableObject(stub, (_instance, ctx) => {
          const repo = new SqliteRepo(new DoSqlBackend(ctx.storage as unknown as DoStorageWithSql));
          return callRepoMethod(repo, req);
        }),
    });
  }
}

// A mock ParserService: returns canned transactions, or throws (the failure path).
function mockParser(result: ParseResult): ParserService {
  return { parse: async () => result };
}
function throwingParser(message: string): ParserService {
  return {
    parse: async () => {
      throw new Error(message);
    },
  };
}

function sampleResult(over: Partial<ParseResult["transactions"][number]> = {}): ParseResult {
  return {
    transactions: [
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-04",
        description: "GROCER A", amount: 40, category: "Groceries", flow: "spend", ...over,
      },
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-09",
        description: "GROCER B", amount: 60, category: "Groceries", flow: "spend", ...over,
      },
    ],
    statements: [
      {
        filename: "amex-2026-05.pdf", source: "amex", account: "card", period: "2026-05",
        closing_balance: 123.45, closing_date: "2026-05-31",
      },
    ],
  };
}

function makeDeps(
  parser: ParserService,
  repos: PerUserDoRepos
): { deps: ConsumerDeps; pdfStore: PdfStore } {
  const pdfStore = pdfStoreOverBucket(env.PDF_BUCKET);
  const jobStore = jobStoreOverKv(env.PARSE_JOBS);
  return {
    pdfStore,
    deps: {
      pdfStore,
      jobStore,
      parser,
      getRepoForUser: (userId) => repos.repoFor(userId),
    },
  };
}

describe("P4 parse-job consumer (workerd: real DO + miniflare R2/KV, parser mocked)", () => {
  it("round-trips a message to rows in the owner's DO, marks done, and deletes the PDF", async () => {
    const repos = new PerUserDoRepos();
    const { deps, pdfStore } = makeDeps(mockParser(sampleResult()), repos);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);

    // Producer side: store the PDF + create a queued job, then build the message.
    const userId = "alice";
    const r2Key = await pdfStore.put(userId, "amex-2026-05.pdf", new Uint8Array([0x25, 0x50, 1]));
    const jobId = "job-alice-1";
    await jobStore.create({ jobId, userId, filename: "amex-2026-05.pdf" });

    const message: ParseJobMessage = { userId, r2Key, filename: "amex-2026-05.pdf", jobId };

    // Consumer side.
    const counts = await handleParseMessage(message, deps);
    expect(counts).toEqual({ inserted: 2, skipped: 0 });

    // Rows landed in alice's DO.
    const repo = await repos.repoFor(userId);
    const { rows, total } = await repo.transactions.list({ source: "amex" });
    expect(total).toBe(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["GROCER A", "GROCER B"]);
    const stmts = await repo.statements.list();
    expect(stmts.some((s) => s.filename === "amex-2026-05.pdf")).toBe(true);

    // Job marked done with the counts.
    const job = await jobStore.get(userId, jobId);
    expect(job?.status).toBe("done");
    expect(job?.inserted).toBe(2);
    expect(job?.skipped).toBe(0);

    // PDF deleted on success (retention default).
    expect(await pdfStore.get(r2Key)).toBeNull();
  });

  it("ISOLATION: user A's job never writes to user B's DO", async () => {
    const repos = new PerUserDoRepos();
    const { deps, pdfStore } = makeDeps(mockParser(sampleResult()), repos);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);

    // Alice uploads + her job processes.
    const aKey = await pdfStore.put("alice", "a.pdf", new Uint8Array([1]));
    await jobStore.create({ jobId: "jA", userId: "alice", filename: "a.pdf" });
    await handleParseMessage(
      { userId: "alice", r2Key: aKey, filename: "a.pdf", jobId: "jA" },
      deps
    );

    // Bob's DO is untouched — distinct DO instance, distinct SQLite DB.
    const bobRepo = await repos.repoFor("bob");
    const { total: bobTotal } = await bobRepo.transactions.list({ source: "amex" });
    expect(bobTotal).toBe(0);

    // Alice's DO has exactly her rows.
    const aliceRepo = await repos.repoFor("alice");
    const { total: aliceTotal } = await aliceRepo.transactions.list({ source: "amex" });
    expect(aliceTotal).toBe(2);

    // And bob can't read alice's job record (per-user key prefix).
    expect(await jobStore.get("bob", "jA")).toBeNull();
    expect(await jobStore.get("alice", "jA")).not.toBeNull();
  });

  it("a forged cross-user r2Key is dropped (CrossUserKeyError), nothing written", async () => {
    const repos = new PerUserDoRepos();
    const { deps, pdfStore } = makeDeps(mockParser(sampleResult()), repos);

    // bob's key, but a message claiming alice owns it.
    const bobKey = await pdfStore.put("bob", "b.pdf", new Uint8Array([2]));
    await expect(
      handleParseMessage({ userId: "alice", r2Key: bobKey, filename: "b.pdf", jobId: "jX" }, deps)
    ).rejects.toThrow(/does not belong to user/);

    // No rows for alice, and bob's PDF is left intact (we refused before touching it).
    const aliceRepo = await repos.repoFor("alice");
    expect((await aliceRepo.transactions.list({ source: "amex" })).total).toBe(0);
    expect(await pdfStore.get(bobKey)).not.toBeNull();
  });

  it("a failing parse LEAVES the PDF and marks the job RETRYING (non-terminal), then rethrows (Queue retries)", async () => {
    const repos = new PerUserDoRepos();
    const { deps, pdfStore } = makeDeps(throwingParser("container 502"), repos);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);

    const r2Key = await pdfStore.put("carol", "c.pdf", new Uint8Array([3]));
    await jobStore.create({ jobId: "jC", userId: "carol", filename: "c.pdf" });

    await expect(
      handleParseMessage({ userId: "carol", r2Key, filename: "c.pdf", jobId: "jC" }, deps)
    ).rejects.toThrow(/container 502/);

    // PDF retained (so the retry can re-fetch the bytes).
    expect(await pdfStore.get(r2Key)).not.toBeNull();

    // A transient failure marks the job `retrying` (NON-terminal — the client keeps
    // polling), NOT terminal `failed`, with the error detail recorded.
    const job = await jobStore.get("carol", "jC");
    expect(job?.status).toBe("retrying");
    expect(job?.error).toMatch(/container 502/);

    // No rows written.
    const repo = await repos.repoFor("carol");
    expect((await repo.transactions.list({ source: "amex" })).total).toBe(0);
  });

  it("an empty parse marks the job failed and deletes the PDF (permanent, no retry)", async () => {
    const repos = new PerUserDoRepos();
    const empty: ParseResult = { transactions: [], statements: [] };
    const { deps, pdfStore } = makeDeps(mockParser(empty), repos);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);

    const r2Key = await pdfStore.put("dave", "d.pdf", new Uint8Array([4]));
    await jobStore.create({ jobId: "jD", userId: "dave", filename: "d.pdf" });

    // Resolves (not throws) — an empty parse is a permanent outcome, not a retry.
    const counts = await handleParseMessage(
      { userId: "dave", r2Key, filename: "d.pdf", jobId: "jD" },
      deps
    );
    expect(counts).toEqual({ inserted: 0, skipped: 0 });

    const job = await jobStore.get("dave", "jD");
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/No transactions/);
    // Deleted (retention default) — re-parsing would just yield empty again.
    expect(await pdfStore.get(r2Key)).toBeNull();
  });
});
