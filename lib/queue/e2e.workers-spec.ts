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
import { handleHostedUpload } from "./upload-handler";
import type { ParserService, ParseResult } from "../parser/service";
import type { ParseJobMessage, QueueLike, QueueSendOptions } from "./types";

// ===========================================================================
// PHASE 3 EXIT TEST — the literal gate.
//
//   "upload -> parsed -> categorized round-trip in hosted mode; PDFs deleted
//    post-parse."
//
// This drives the WHOLE hosted pipeline for a real user, end to end, INSIDE
// workerd, with every production seam EXCEPT the parser container exercised
// against its real binding:
//
//   handleHostedUpload (P5 producer)
//      -> PdfStore.put            (real miniflare R2)
//      -> jobStore.create         (real miniflare KV)              status=queued
//      -> enqueueParseJob         (a capturing fake Queue — see note)
//   ... the captured message is then fed to ...
//   handleParseMessage (P4 consumer)
//      -> PdfStore.get            (real R2)
//      -> ParserService.parse     (MOCKED — see note)
//      -> repo.batch { insertMany; recategorizeAll }   (real per-user DO SQL)
//      -> jobStore.markDone {inserted, skipped}                     status=done
//      -> PdfStore.delete         (real R2)             PDF gone post-parse
//
// MOCKED, and WHY:
//   - The PARSER CONTAINER (RemoteParser -> Cloudflare Container). Containers
//     are Python+poppler over a Docker image; they CANNOT run under workerd /
//     miniflare locally. We mock ParserService.parse() to return a known
//     { transactions, statements }. This is the documented limitation — every
//     OTHER hop (R2, KV, the per-user DO's native SQLite, the repo batch, the
//     recategorize pass) is the REAL production code against a REAL binding.
//   - The QUEUE itself: miniflare's pool can't deliver a real queue round-trip
//     to a `queue()` handler inside a unit test, so we use a capturing fake
//     producer (records the sent message) and invoke the consumer's pure core
//     (handleParseMessage) on that message directly. The producer->message and
//     message->consumer contract is the same object the real Queue would carry
//     (ParseJobMessage), so the wiring under test is identical.
//
// PROVES (the exit criteria):
//   1. an uploaded PDF's bytes round-trip to ROWS in THAT user's DO;
//   2. the rows are CATEGORIZED by the DO's rules (recategorizeAll ran) — a row
//      the parser returned as 'Other / uncategorized' but whose description
//      matches a seeded rule comes out re-tagged, and shows up in repo.summary;
//   3. the job status went queued -> done with the correct {inserted, skipped};
//   4. the PDF was DELETED from R2 after a successful parse;
//   5. a SECOND user's DO is EMPTY — tenant isolation by construction.
// ===========================================================================

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_SQL: DurableObjectNamespace;
    PDF_BUCKET: R2BucketLike;
    PARSE_JOBS: KvNamespaceLike;
  }
}

// Per-user Repo over a REAL DO's native SQLite — one DO instance per userId (==
// one isolated SQLite DB), the SAME tenancy model production uses. Every repo op
// runs inside runInDurableObject for that user's stub (workerd forbids touching
// one DO's storage from another's context), dispatched through the SAME
// repo-rpc envelope + request-side client (repoOverDoStub) production uses.
class PerUserDoRepos {
  private stubs = new Map<string, DurableObjectStub>();
  private counter = 0;

  private stubFor(userId: string): DurableObjectStub {
    let stub = this.stubs.get(userId);
    if (!stub) {
      const id = env.TEST_SQL.idFromName(`e2e-${userId}-${this.counter++}`);
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

// A capturing fake of the PARSE_QUEUE producer binding: records each message the
// upload handler enqueues so the test can hand it straight to the consumer (the
// real Queue would carry the identical ParseJobMessage object).
class CapturingQueue implements QueueLike<ParseJobMessage> {
  readonly sent: ParseJobMessage[] = [];
  async send(body: ParseJobMessage, _options?: QueueSendOptions): Promise<void> {
    this.sent.push(body);
  }
}

// Mock ParserService (the container). Returns canned transactions/statements.
function mockParser(result: ParseResult): ParserService {
  return { parse: async () => result };
}

// A realistic parse result whose categories are what the PYTHON parser ships:
// generic 'Other / uncategorized' for a merchant the in-app rules will catch.
// STARBUCKS matches the seeded "Coffee" rule and REAL CDN SUPERSTORE matches
// "Groceries", so after recategorizeAll the DO must have re-tagged BOTH — that
// is the "categorized" half of the exit criterion.
function uncategorizedAmexResult(): ParseResult {
  return {
    transactions: [
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-04",
        description: "STARBUCKS #1234 VANCOUVER", amount: 6.75,
        category: "Other / uncategorized", flow: "spend",
      },
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-09",
        description: "REAL CDN SUPERSTORE #4021", amount: 84.10,
        category: "Other / uncategorized", flow: "spend",
      },
    ],
    statements: [
      {
        filename: "amex-2026-05.pdf", source: "amex", account: "card", period: "2026-05",
        closing_balance: 90.85, closing_date: "2026-05-31",
      },
    ],
  };
}

describe("PHASE 3 EXIT: upload -> parsed -> categorized round-trip (hosted, workerd; container mocked)", () => {
  it("drives the whole pipeline for a real user: rows land categorized in their DO, job done, PDF deleted, second user empty", async () => {
    const repos = new PerUserDoRepos();
    const pdfStore: PdfStore = pdfStoreOverBucket(env.PDF_BUCKET);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);
    const queue = new CapturingQueue();

    const userId = "alice";
    const filename = "amex-2026-05.pdf";
    // A handful of bytes standing in for a PDF (the real bytes only matter to the
    // container, which is mocked — R2 stores+returns them verbatim regardless).
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

    // ---- (A) PRODUCER: the hosted upload route's core (P5). -----------------
    const { jobId } = await handleHostedUpload(
      { userId, filename, bytes },
      { pdfStore, jobStore, queue, newJobId: () => "job-alice-e2e" },
    );
    expect(jobId).toBe("job-alice-e2e");

    // Status is queued right after upload, and exactly ONE message was enqueued.
    const queued = await jobStore.get(userId, jobId);
    expect(queued?.status).toBe("queued");
    expect(queue.sent).toHaveLength(1);

    const message: ParseJobMessage = queue.sent[0];
    expect(message).toMatchObject({ userId, filename, jobId });
    // The R2 key is per-user-prefixed and the bytes are really in R2.
    expect(message.r2Key.startsWith(`u/${userId}/`)).toBe(true);
    expect(await pdfStore.get(message.r2Key)).not.toBeNull();

    // ---- (B) CONSUMER: the queue handler's core (P4), parser MOCKED. --------
    const deps: ConsumerDeps = {
      pdfStore,
      jobStore,
      parser: mockParser(uncategorizedAmexResult()),
      getRepoForUser: (uid) => repos.repoFor(uid),
    };
    const counts = await handleParseMessage(message, deps);
    expect(counts).toEqual({ inserted: 2, skipped: 0 });

    // ---- (C) ASSERT: rows in alice's DO, CATEGORIZED. -----------------------
    const aliceRepo = await repos.repoFor(userId);

    const { rows, total } = await aliceRepo.transactions.list({ source: "amex" });
    expect(total).toBe(2);

    // recategorizeAll re-tagged the parser's 'Other / uncategorized' rows using
    // the DO's seeded rules: STARBUCKS -> Coffee, SUPERSTORE -> Groceries.
    const byDesc = Object.fromEntries(rows.map((r) => [r.description.split(" ")[0], r.category]));
    expect(byDesc["STARBUCKS"]).toBe("Coffee");
    expect(byDesc["REAL"]).toBe("Groceries"); // "REAL CDN SUPERSTORE ..."
    // None left uncategorized.
    expect(rows.every((r) => r.category !== "Other / uncategorized")).toBe(true);

    // And the categorized rows surface in the DASHBOARD summary (repo.summary):
    // the category breakdown is built from the recategorized data.
    const breakdown = await aliceRepo.summary.categoryBreakdown();
    const cats = Object.fromEntries(breakdown.map((b) => [b.category, b]));
    expect(cats["Coffee"]?.count).toBe(1);
    expect(cats["Coffee"]?.total).toBeCloseTo(6.75, 2);
    expect(cats["Groceries"]?.count).toBe(1);
    expect(cats["Groceries"]?.total).toBeCloseTo(84.10, 2);
    expect(cats["Other / uncategorized"]).toBeUndefined();

    // Monthly totals (the dashboard's top bar) reflect the parsed spend.
    const monthly = await aliceRepo.summary.monthlyTotals();
    const may = monthly.find((m) => m.month === "2026-05");
    expect(may?.total).toBeCloseTo(90.85, 2);

    // The statement metadata (closing balance/date — net-worth anchor) persisted.
    const stmts = await aliceRepo.statements.list();
    expect(stmts.some((s) => s.filename === filename && s.closing_balance === 90.85)).toBe(true);

    // ---- (D) ASSERT: job queued -> done with the right counts. --------------
    const done = await jobStore.get(userId, jobId);
    expect(done?.status).toBe("done");
    expect(done?.inserted).toBe(2);
    expect(done?.skipped).toBe(0);

    // ---- (E) ASSERT: the PDF was DELETED from R2 post-parse. ----------------
    expect(await pdfStore.get(message.r2Key)).toBeNull();

    // ---- (F) ASSERT: a SECOND user's DO is EMPTY (isolation). ---------------
    const bobRepo = await repos.repoFor("bob");
    expect((await bobRepo.transactions.list({ source: "amex" })).total).toBe(0);
    expect((await bobRepo.summary.categoryBreakdown()).length).toBe(0);
    // ...and bob can't read alice's job record (per-user KV key prefix).
    expect(await jobStore.get("bob", jobId)).toBeNull();
  });
});
