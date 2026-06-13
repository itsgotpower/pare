// ---------------------------------------------------------------------------
// Parse-job consumer — the Cloudflare Queue handler that turns an enqueued
// `{ userId, r2Key, filename, jobId }` message into rows in the owner's Durable
// Object. This is the background half of the async upload pipeline (P4); the
// producer half (the upload route, P5) stores the PDF + enqueues the message.
//
// Per message, the consumer:
//   1. guards the R2 key belongs to the message's userId (drop + log if not);
//   2. fetches the PDF bytes from R2 (PdfStore.get);
//   3. parses via getParserService().parse(bytes) (RemoteParser -> container);
//   4. writes statement + transactions + recategorize in ONE repo.batch() — the
//      EXACT pattern app/api/upload/route.ts uses (read counts off the batch
//      return, never off a buffered write mid-closure);
//   5. on success: marks the job done {inserted, skipped} and DELETES the PDF from
//      R2 (retention default — see shouldPersistAfterParse);
//   6. on failure: marks the job failed, LEAVES the PDF in R2, and rethrows so the
//      Queue retries the message (Cloudflare semantics: a throw from queue() fails
//      the whole batch and redelivers it).
//
// The handler is split into a pure `handleParseMessage(message, deps)` core with
// every external dependency injected, and a `queueHandler(batch, env)` that
// resolves the real bindings and acks/retries per message. The split is what lets
// the tests drive the full round-trip with the container/ParserService MOCKED and
// miniflare R2 + a real per-user DO, without a live Worker.
// ---------------------------------------------------------------------------

import { computeDedupKey } from "../db/transactions";
import type { Repo, NewTransaction } from "../repo/types";
import type { ParserService, ParseResult } from "../parser/service";
import type { PdfStore } from "../storage/pdf-store";
import { keyBelongsToUser, shouldPersistAfterParse } from "../storage/pdf-store";
import type { KvJobStore } from "./job-store";
import type { ParseJobMessage, QueueMessageBatchLike } from "./types";

// Dependencies the consumer core needs — injected so the test harness can supply
// miniflare R2 + a fake ParserService + a per-user in-process DO, and production
// supplies the real bindings (see queueHandler below).
export interface ConsumerDeps {
  pdfStore: PdfStore;
  parser: ParserService;
  jobStore: KvJobStore;
  // Resolve the per-user Repo (getRepoForUser in prod; an in-process scoped repo
  // in tests). Async to mirror getRepoForUser's signature.
  getRepoForUser: (userId: string) => Promise<Repo>;
}

// Thrown when the message references a key that doesn't belong to its userId.
// We DROP (ack) these rather than retry — a retry can never make a cross-tenant
// key valid, and we must not leave such a message redelivering forever.
export class CrossUserKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossUserKeyError";
  }
}

/**
 * Process ONE parse-job message end to end. Resolves normally on success (the
 * caller acks); THROWS on a parse/transport/DB failure (the caller lets the Queue
 * retry). A CrossUserKeyError is thrown for an isolation violation — the caller
 * treats it as a permanent drop (ack), not a retry.
 */
export async function handleParseMessage(
  message: ParseJobMessage,
  deps: ConsumerDeps
): Promise<{ inserted: number; skipped: number }> {
  const { userId, r2Key, filename, jobId } = message;
  const { pdfStore, parser, jobStore, getRepoForUser } = deps;

  // (1) Tenancy guard: the key MUST live under this user's R2 prefix. A mismatch
  // means a malformed/forged message — drop it (permanent), never parse it.
  if (!keyBelongsToUser(r2Key, userId)) {
    // Don't touch the job record (it may belong to another user); just refuse.
    throw new CrossUserKeyError(
      `parse consumer: r2Key ${r2Key} does not belong to user ${userId}; dropping job ${jobId}`
    );
  }

  await jobStore.markParsing(userId, jobId);

  try {
    // (2) Fetch the PDF bytes from R2.
    const bytes = await pdfStore.get(r2Key);
    if (!bytes) {
      // The object is gone (already parsed+deleted, or never stored). Nothing to
      // retry against — fail the job permanently but do NOT throw, so the Queue
      // doesn't redeliver a message whose payload can never be recovered.
      await jobStore.markFailed(userId, jobId, "PDF not found in storage");
      return { inserted: 0, skipped: 0 };
    }

    // (3) Parse (RemoteParser -> container in prod; mocked in tests).
    const result: ParseResult = await parser.parse(bytes);
    const rows = result.transactions;
    const metas = result.statements;

    if (rows.length === 0) {
      // A successfully-parsed-but-empty PDF is a permanent outcome, not a
      // transient error: mark failed and delete (retention default) — retrying
      // would just re-parse to empty again.
      await jobStore.markFailed(
        userId,
        jobId,
        "No transactions found in PDF (unsupported statement format?)"
      );
      if (!shouldPersistAfterParse()) await pdfStore.delete(r2Key);
      return { inserted: 0, skipped: 0 };
    }

    // (4) Insert + recategorize in ONE repo.batch() — the EXACT pattern from
    // app/api/upload/route.ts (do NOT diverge; P5 owns that route). Read the
    // counts off the batch return, NOT off a write's return mid-closure.
    const repo = await getRepoForUser(userId);
    await repo.categories.seed();

    const source = rows[0].source;
    const account = rows[0].account;
    const period = rows[0].period;
    const meta = metas[0];

    const statementId = await repo.statements.insert({
      filename,
      source,
      account,
      period,
      row_count: rows.length,
      closing_balance: meta?.closing_balance ?? null,
      closing_date: meta?.closing_date ?? null,
    });

    const seqMap = new Map<string, number>();
    const newTxns: NewTransaction[] = rows.map((row) => {
      const seqKey = `${row.source}|${row.txn_date}|${row.description}|${row.amount}`;
      const seq = (seqMap.get(seqKey) || 0) + 1;
      seqMap.set(seqKey, seq);

      return {
        statement_id: statementId || null,
        source: row.source,
        account: row.account,
        period: row.period,
        txn_date: row.txn_date,
        description: row.description,
        amount: row.amount,
        category: row.category,
        flow: row.flow,
        dedup_key: computeDedupKey(row.source, row.txn_date, row.description, row.amount, seq),
      };
    });

    const { inserted, skipped } = await repo.batch(async () => {
      const res = await repo.transactions.insertMany(newTxns);
      // recategorizeAll runs unconditionally: inside batch() on the DO backend the
      // insertMany result is a placeholder, so we cannot branch on it here (the
      // hosted-pattern fix). recategorizeAll is idempotent + cheap. The batch's
      // return value (insertMany's real result, returnIndex 0) supplies the counts.
      await repo.categories.recategorizeAll();
      return res;
    });

    // (5) Success: mark done with the counts, then drop the PDF (retention default).
    await jobStore.markDone(userId, jobId, { inserted, skipped });
    if (!shouldPersistAfterParse()) await pdfStore.delete(r2Key);

    return { inserted, skipped };
  } catch (err) {
    // (6) Transient/parse/DB failure: record it, KEEP the PDF (so the retry can
    // re-fetch the bytes), and rethrow so the Queue redelivers per its retry
    // policy. CrossUserKeyError is handled upstream; everything else lands here.
    const detail = err instanceof Error ? err.message : String(err);
    await jobStore.markFailed(userId, jobId, detail);
    throw err;
  }
}

/**
 * queueHandler — the Worker's `queue` consumer. Resolves the real bindings off
 * `env` and processes each message in the batch independently: ack on success or
 * a permanent drop (cross-user key / missing PDF resolve normally), retry on a
 * transient failure (thrown). Per-message ack/retry (not ackAll/retryAll) so one
 * poison message can't fail its whole batch's worth of healthy siblings.
 *
 * `env` is typed structurally (the codebase ships no @cloudflare/workers-types);
 * the bindings (PDF_BUCKET, PARSE_JOBS, PARSE_QUEUE consumer) are wired in P6. The
 * factories are imported lazily so this module stays import-safe off-Workers.
 */
export async function queueHandler(
  batch: QueueMessageBatchLike<ParseJobMessage>,
  env: Record<string, unknown>
): Promise<void> {
  // Resolve the per-request-independent dependencies once for the batch. Imported
  // lazily (and via the explicit-binding factories) so plain Node/dev never loads
  // the Workers-only resolution path.
  const { pdfStoreOverBucket } = await import("../storage/pdf-store");
  const { jobStoreOverKv } = await import("./job-store");
  const { getParserService } = await import("../parser/service");
  const { getRepoForUser } = await import("../repo");

  const deps: ConsumerDeps = {
    pdfStore: pdfStoreOverBucket(env.PDF_BUCKET as never),
    jobStore: jobStoreOverKv(env.PARSE_JOBS as never),
    parser: getParserService(),
    getRepoForUser,
  };

  for (const msg of batch.messages) {
    try {
      await handleParseMessage(msg.body, deps);
      msg.ack();
    } catch (err) {
      if (err instanceof CrossUserKeyError) {
        // Permanent: a retry can never make a forged key valid. Drop it.
        console.error(err.message);
        msg.ack();
      } else {
        // Transient: let the Queue redeliver this message (its retry policy
        // applies). The job is already marked failed + the PDF is retained.
        console.error(
          `parse consumer: job ${msg.body.jobId} failed (attempt ${msg.attempts}):`,
          err instanceof Error ? err.message : err
        );
        msg.retry();
      }
    }
  }
}
