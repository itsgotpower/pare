import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { pdfStoreOverBucket, type R2BucketLike } from "../storage/pdf-store";
import { jobStoreOverKv, type KvNamespaceLike } from "./job-store";
import { getRepoForUser } from "../repo";
import { queueHandler } from "./consumer";
import type { ParserContainerBinding } from "../parser/parser-container";
import type { ParseResult } from "../parser/service";
import type {
  ParseJobMessage,
  QueueMessageLike,
  QueueMessageBatchLike,
} from "./types";

// ===========================================================================
// REGRESSION GUARD for the consumer-wiring masking (findings #1 + #2).
//
// The e2e / consumer.workers-spec tests call handleParseMessage(message, deps)
// with deps INJECTED — so they never exercise queueHandler's REAL dep resolution.
// That masked two bugs: queueHandler resolved the parser off
// process.env.PARSER_SERVICE_URL (never set) and the repo off
// getCloudflareContext() (not available in a queue() invocation). This test calls
// the REAL queueHandler(batch, env) with a FAKE env and proves a message parses
// end-to-end through queueHandler's own resolution:
//
//   env.PARSER     — a fake Container binding (the container can't run in workerd),
//                    so we assert queueHandler builds `new ContainerParser(env.PARSER)`
//                    and routes through it — NOT a URL/process.env path.
//   env.USER_DATA  — a REAL Durable Object namespace (UserDataTestObject) exposing
//                    the production `call` RPC, so getRepoForUser(userId, env.USER_DATA)
//                    resolves the user's DO off env — NOT getCloudflareContext().
//   env.PDF_BUCKET — real miniflare R2.   env.PARSE_JOBS — real miniflare KV.
// ===========================================================================

declare module "cloudflare:test" {
  interface ProvidedEnv {
    USER_DATA: DurableObjectNamespace;
    PDF_BUCKET: R2BucketLike;
    PARSE_JOBS: KvNamespaceLike;
  }
}

// A fake PARSER Container binding: getByName("default") -> instance.fetch returns
// canned parser JSON. The real container is Python+poppler over Docker and cannot
// run under workerd, so this stands in — the point is that queueHandler resolves
// the parser OFF env.PARSER (ContainerParser), not a URL.
function fakeParserBinding(result: ParseResult): ParserContainerBinding {
  return {
    getByName() {
      return {
        async fetch() {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      };
    },
  };
}

function sampleResult(): ParseResult {
  return {
    transactions: [
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-04",
        description: "STARBUCKS #1234", amount: 6.75,
        category: "Other / uncategorized", flow: "spend",
      },
      {
        source: "amex", account: "card", period: "2026-05", txn_date: "2026-05-09",
        description: "GROCER B", amount: 60, category: "Groceries", flow: "spend",
      },
    ],
    statements: [
      {
        filename: "amex-2026-05.pdf", source: "amex", account: "card", period: "2026-05",
        closing_balance: 66.75, closing_date: "2026-05-31",
      },
    ],
  };
}

// A minimal MessageBatch over the queue's structural contract, recording ack/retry.
function makeBatch(
  body: ParseJobMessage,
  attempts = 1
): { batch: QueueMessageBatchLike<ParseJobMessage>; calls: { acked: number; retried: number } } {
  const calls = { acked: 0, retried: 0 };
  const msg: QueueMessageLike<ParseJobMessage> = {
    id: "m1",
    timestamp: new Date(),
    body,
    attempts,
    ack() {
      calls.acked++;
    },
    retry() {
      calls.retried++;
    },
  };
  return {
    calls,
    batch: {
      queue: "parse-queue",
      messages: [msg],
      ackAll() {},
      retryAll() {},
    },
  };
}

describe("queueHandler REAL dep-resolution (regression guard for #1 + #2)", () => {
  it("parses a message end-to-end via queueHandler(batch, env) with a fake env", async () => {
    const userId = "wired-alice";
    const filename = "amex-2026-05.pdf";

    // Producer side: stage the PDF + a queued job in the real R2/KV bindings.
    const pdfStore = pdfStoreOverBucket(env.PDF_BUCKET);
    const jobStore = jobStoreOverKv(env.PARSE_JOBS);
    const r2Key = await pdfStore.put(userId, filename, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const jobId = "job-wired-1";
    await jobStore.create({ jobId, userId, filename });

    // The env exactly as the Worker hands it to queue(): every binding off env,
    // PARSER faked (container can't run here), USER_DATA the real DO namespace.
    const fakeEnv = {
      PDF_BUCKET: env.PDF_BUCKET,
      PARSE_JOBS: env.PARSE_JOBS,
      PARSER: fakeParserBinding(sampleResult()),
      USER_DATA: env.USER_DATA,
    };

    const { batch, calls } = makeBatch({ userId, r2Key, filename, jobId });

    // Drive the REAL queueHandler — its own resolution of parser + repo runs.
    await queueHandler(batch, fakeEnv);

    // Message acked (success), not retried.
    expect(calls.acked).toBe(1);
    expect(calls.retried).toBe(0);

    // Job advanced queued -> done with the right counts, through the REAL wiring.
    const job = await jobStore.get(userId, jobId);
    expect(job?.status).toBe("done");
    expect(job?.inserted).toBe(2);
    expect(job?.skipped).toBe(0);

    // The PDF was deleted post-parse (retention default).
    expect(await pdfStore.get(r2Key)).toBeNull();

    // Rows really landed in the user's DO (resolved the SAME way the consumer did:
    // getRepoForUser(userId, env.USER_DATA)) AND were recategorized (STARBUCKS ->
    // Coffee), proving the full container->repo path through queueHandler's wiring.
    const repo = await getRepoForUser(userId, env.USER_DATA as never);
    const { rows, total } = await repo.transactions.list({ source: "amex" });
    expect(total).toBe(2);
    const byDesc = Object.fromEntries(rows.map((r) => [r.description.split(" ")[0], r.category]));
    expect(byDesc["STARBUCKS"]).toBe("Coffee");
  });
});
