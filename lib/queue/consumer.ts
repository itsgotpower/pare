// ---------------------------------------------------------------------------
// Parse-job consumer — the Cloudflare Queue handler that turns an enqueued
// `{ userId, r2Key, filename, jobId }` message into rows in the owner's Durable
// Object. This is the background half of the async upload pipeline (P4); the
// producer half (the upload route, P5) stores the PDF + enqueues the message.
//
// Per message, the consumer:
//   1. guards the R2 key belongs to the message's userId (drop + log if not);
//   2. fetches the PDF bytes from R2 (PdfStore.get);
//   3. parses via the injected ParserService (ContainerParser -> container in prod);
//   4. writes statement + transactions + recategorize via insertParsedStatement —
//      the ONE shared helper app/api/upload/route.ts also uses (counts come off the
//      batch return, never off a buffered write mid-closure);
//   5. on success: marks the job done {inserted, skipped} and DELETES the PDF from
//      R2 (retention default — see shouldPersistAfterParse);
//   6. on a transient failure: marks the job `retrying` (NON-terminal — the client
//      keeps polling), LEAVES the PDF in R2, and rethrows so the Queue retries the
//      message (a throw from queue() redelivers it). A permanent outcome
//      (unsupported PDF / forged key) lands as terminal `failed` and is NOT retried.
//
// The handler is split into a pure `handleParseMessage(message, deps)` core with
// every external dependency injected, and a `queueHandler(batch, env)` that
// resolves the real bindings OFF `env` (PDF_BUCKET, PARSE_JOBS, PARSER, USER_DATA)
// and acks/retries per message. Resolving off env (not getCloudflareContext /
// process.env) is essential: inside a Cloudflare queue() invocation neither is
// reliably available. The split lets the tests drive the full round-trip with the
// container/ParserService MOCKED and miniflare R2 + a real per-user DO.
// ---------------------------------------------------------------------------

import type { Repo } from "../repo/types";
import { insertParsedStatement } from "../repo/insert-parsed";
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

// Read-after-write tolerance for an R2 get() that returns null. R2 is
// strongly-consistent for read-after-PUT, but a delivered message could in
// principle race ahead of the object becoming visible. Rather than orphan the PDF
// on a single transient miss, treat null as a RETRYABLE miss for the first few
// delivery attempts (rethrow -> Queue redelivers); only past this bound do we
// conclude the object is truly gone and fail permanently (the bytes can never be
// recovered, so retrying forever is pointless). `attempts` starts at 1.
const R2_MISS_MAX_ATTEMPTS = 5;

/**
 * Process ONE parse-job message end to end. Resolves normally on a SUCCESS or a
 * PERMANENT outcome (the caller acks). THROWS on a TRANSIENT failure (the caller
 * lets the Queue retry) — the job is left `retrying` (non-terminal). A
 * CrossUserKeyError is thrown for an isolation violation; the caller treats it as
 * a permanent drop (ack), not a retry.
 *
 * `attempts` is the message's delivery-attempt count (msg.attempts; starts at 1).
 * It drives the bounded read-after-write retry policy for an R2 miss.
 */
export async function handleParseMessage(
  message: ParseJobMessage,
  deps: ConsumerDeps,
  attempts = 1
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
      // R2 returned null. For the first few delivery attempts treat this as a
      // possibly-transient read-after-write miss: rethrow so the Queue retries
      // (job left `retrying`, PDF — if it exists — retained). Only once attempts
      // are exhausted do we conclude the object is truly gone and fail
      // PERMANENTLY (no throw): a message whose payload can never be recovered
      // must not redeliver forever.
      if (attempts < R2_MISS_MAX_ATTEMPTS) {
        // Rethrow: the unified catch below marks the job `retrying` and the Queue
        // redelivers (read-after-write tolerance).
        throw new Error(
          `PDF not yet visible in storage (attempt ${attempts}); retrying`
        );
      }
      await jobStore.markFailed(
        userId,
        jobId,
        `PDF not found in storage after ${attempts} attempts`
      );
      return { inserted: 0, skipped: 0 };
    }

    // (3) Parse (ContainerParser -> container in prod; mocked in tests).
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
      await deletePdfBestEffort(pdfStore, r2Key, jobId);
      return { inserted: 0, skipped: 0 };
    }

    // (4) Insert + recategorize via the ONE shared helper app/api/upload/route.ts
    // also uses (do NOT diverge). Counts come off the batch return, never off a
    // buffered write mid-closure.
    const repo = await getRepoForUser(userId);
    await repo.categories.seed();
    const { inserted, skipped } = await insertParsedStatement(repo, filename, rows, metas);

    // (5) Success: mark done with the counts (idempotent: a redelivery whose insert
    // already committed won't clobber these with {0,0}), then drop the PDF.
    await jobStore.markDone(userId, jobId, { inserted, skipped });
    await deletePdfBestEffort(pdfStore, r2Key, jobId);

    return { inserted, skipped };
  } catch (err) {
    // (6) Transient/parse/DB failure: record it as `retrying` (NON-terminal — the
    // client keeps polling), KEEP the PDF (so the retry can re-fetch the bytes),
    // and rethrow so the Queue redelivers per its retry policy. We use `retrying`
    // (not terminal `failed`) for every rethrow path because attempts/max aren't
    // reliably distinguishable here — the client treats only done/failed as
    // terminal, so a transient blip never prematurely looks permanent.
    // CrossUserKeyError is handled upstream; everything else lands here.
    const detail = err instanceof Error ? err.message : String(err);
    await jobStore.markRetrying(userId, jobId, detail);
    throw err;
  }
}

// Delete the PDF after a recorded SUCCESS/permanent outcome, best-effort. The job
// status is already written, so a transient R2 delete failure must NOT flip a done
// job to failed or trigger a retry — log and leave the orphan; the success stands.
async function deletePdfBestEffort(
  pdfStore: PdfStore,
  r2Key: string,
  jobId: string
): Promise<void> {
  if (shouldPersistAfterParse()) return;
  try {
    await pdfStore.delete(r2Key);
  } catch (err) {
    console.error(
      `parse consumer: post-success PDF delete failed for job ${jobId} (leaving orphan ${r2Key}):`,
      err instanceof Error ? err.message : err
    );
  }
}

// The Worker `env` slice the queue consumer resolves its bindings from. Declared
// structurally (the codebase ships no @cloudflare/workers-types). Every binding
// MUST come off this `env` — NOT off process.env or getCloudflareContext(), which
// are not reliably available inside a Cloudflare queue() invocation. The bindings:
//   PDF_BUCKET  — R2 (PDF bytes)              -> PdfStore
//   PARSE_JOBS  — KV (job-status records)     -> JobStore
//   PARSER      — Container DO namespace       -> ContainerParser (parse via container)
//   USER_DATA   — per-user Durable Object ns   -> getRepoForUser(userId, USER_DATA)
export interface QueueConsumerEnv {
  PDF_BUCKET: unknown;
  PARSE_JOBS: unknown;
  PARSER: unknown;
  USER_DATA: unknown;
}

/**
 * queueHandler — the Worker's `queue` consumer. Resolves the real bindings off
 * `env` (see QueueConsumerEnv — the masking bug was resolving the parser off
 * process.env.PARSER_SERVICE_URL and the repo off getCloudflareContext(), neither
 * available in a queue() invocation). Processes each message independently: ack on
 * success or a permanent outcome (cross-user key / exhausted-miss resolve
 * normally), retry on a transient failure (thrown). Per-message ack/retry (not
 * ackAll/retryAll) so one poison message can't fail its whole batch's siblings.
 *
 * Factories are imported lazily so this module stays import-safe off-Workers.
 */
export async function queueHandler(
  batch: QueueMessageBatchLike<ParseJobMessage>,
  env: QueueConsumerEnv
): Promise<void> {
  // Resolve the per-batch dependencies once, ALL off `env`. Imported lazily so
  // plain Node/dev never loads the Workers-only resolution path.
  const { pdfStoreOverBucket } = await import("../storage/pdf-store");
  const { jobStoreOverKv } = await import("./job-store");
  const { ContainerParser } = await import("../parser/service");
  const { getRepoForUser } = await import("../repo");

  const deps: ConsumerDeps = {
    pdfStore: pdfStoreOverBucket(env.PDF_BUCKET as never),
    jobStore: jobStoreOverKv(env.PARSE_JOBS as never),
    // Parse via the PARSER Container binding — the ONE canonical container path.
    parser: new ContainerParser(env.PARSER as never),
    // Thread env.USER_DATA into repo resolution (do NOT reach getCloudflareContext
    // here — it's not available in queue()). getRepoForUser falls back to the
    // request-path resolver when ns is omitted, so the fetch-path callers are
    // unchanged.
    getRepoForUser: (userId: string) => getRepoForUser(userId, env.USER_DATA as never),
  };

  for (const msg of batch.messages) {
    try {
      await handleParseMessage(msg.body, deps, msg.attempts);
      msg.ack();
    } catch (err) {
      if (err instanceof CrossUserKeyError) {
        // Permanent: a retry can never make a forged key valid. Drop it.
        console.error(err.message);
        msg.ack();
      } else {
        // Transient: let the Queue redeliver this message (its retry policy
        // applies). The job is already marked `retrying` + the PDF is retained.
        console.error(
          `parse consumer: job ${msg.body.jobId} failed (attempt ${msg.attempts}):`,
          err instanceof Error ? err.message : err
        );
        msg.retry();
      }
    }
  }
}
