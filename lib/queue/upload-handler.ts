// ---------------------------------------------------------------------------
// handleHostedUpload — the P5 hosted-upload pipeline, factored out of the route
// as a pure, dependency-injected function (mirrors handleParseMessage in
// consumer.ts). The route resolves the caller + the real R2/Queue/KV bindings
// and hands them in here; tests inject miniflare R2 + KV + a fake queue.
//
// It does the four hosted steps AFTER the caller is authenticated:
//   1. PdfStore.put(userId, filename, bytes)   -> r2Key   (PDF lands in R2)
//   2. jobStore.create({ jobId, userId, filename })       (status = queued)
//   3. enqueueParseJob(queue, { userId, r2Key, filename, jobId })
//   4. return { jobId }                          (the route replies 202)
//
// The PDF is NOT parsed here — parsing is the queue consumer's job (P4). The
// upload request returns immediately so the (mobile) client can poll the status
// endpoint with the jobId.
//
// userId is ALWAYS the authenticated caller's id (resolved by the route from the
// cookie/bearer); it is never read from the request body. Every per-user key
// (R2 prefix, KV prefix, queue message) is derived from it, so an upload can only
// ever write to the caller's own tenant.
// ---------------------------------------------------------------------------

import type { PdfStore } from "../storage/pdf-store";
import type { KvJobStore } from "./job-store";
import { enqueueParseJob } from "./producer";
import type { ParseJobMessage, QueueLike } from "./types";

export interface HostedUploadDeps {
  pdfStore: PdfStore;
  jobStore: KvJobStore;
  queue: QueueLike<ParseJobMessage>;
  /** Override only in tests; defaults to crypto.randomUUID(). */
  newJobId?: () => string;
}

export interface HostedUploadInput {
  /** The AUTHENTICATED caller. Never sourced from the request body/query. */
  userId: string;
  filename: string;
  bytes: Uint8Array;
  /**
   * Caller's billing plan, resolved by the route at upload time. Rides the queue
   * message so the consumer can enforce the account cap (see ParseJobMessage).
   * Omit when the cloud billing layer is off (self-host, email-in).
   */
  planId?: string;
}

export interface HostedUploadResult {
  jobId: string;
}

/**
 * Run the hosted upload pipeline for an already-authenticated caller. Returns the
 * jobId the route hands back (202). Throws only on infra failure (R2/KV/queue
 * unavailable) — input validation (auth, content-type) is the route's job.
 */
export async function handleHostedUpload(
  input: HostedUploadInput,
  deps: HostedUploadDeps
): Promise<HostedUploadResult> {
  const { userId, filename, bytes, planId } = input;
  const jobId = (deps.newJobId ?? (() => crypto.randomUUID()))();

  // 1. Persist the PDF bytes under the caller's per-user R2 prefix.
  const r2Key = await deps.pdfStore.put(userId, filename, bytes);

  // 2. Record a `queued` job under the caller's per-user KV prefix.
  await deps.jobStore.create({ jobId, userId, filename });

  // 3. Enqueue the parse job; the consumer (P4) fetches the bytes from r2Key,
  //    parses, writes rows to the user's DO, and advances the job record.
  const message: ParseJobMessage = { userId, r2Key, filename, jobId, ...(planId ? { planId } : {}) };
  await enqueueParseJob(deps.queue, message);

  return { jobId };
}
