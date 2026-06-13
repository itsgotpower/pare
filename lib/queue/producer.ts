// ---------------------------------------------------------------------------
// Parse-job producer — enqueue a `{ userId, r2Key, filename, jobId }` message
// onto the PARSE_QUEUE binding. Called by the upload route (P5) AFTER it has
// stored the PDF in R2 (PdfStore.put) and recorded a `queued` job (JobStore).
//
// The binding is resolved the SAME lazy way getPdfStore() resolves PDF_BUCKET and
// getRepoForUser() resolves USER_DATA — via @opennextjs/cloudflare's
// getCloudflareContext, imported lazily so plain Node/dev (and tests) don't
// hard-depend on the Workers runtime. The real PARSE_QUEUE binding is wired in P6;
// until then getParseQueue() throws a clear error in hosted mode.
// ---------------------------------------------------------------------------

import type { ParseJobMessage, QueueLike } from "./types";

/**
 * Enqueue a parse job. `queue` is the PARSE_QUEUE producer binding; pass it
 * explicitly (the upload route gets it via getParseQueue(), tests inject a fake)
 * so this function carries no runtime dependency and is trivially unit-testable.
 *
 * Sent with contentType "json" so the consumer receives the message body as the
 * structured object, not a stringified blob.
 */
export async function enqueueParseJob(
  queue: QueueLike<ParseJobMessage>,
  message: ParseJobMessage
): Promise<void> {
  await queue.send(message, { contentType: "json" });
}

// Resolve the PARSE_QUEUE producer binding for the current request (Workers only),
// imported lazily so the @opennextjs/cloudflare package is absent in plain
// Node/dev — exactly how lib/storage/pdf-store.ts resolves PDF_BUCKET.
async function getParseQueueBinding(): Promise<QueueLike<ParseJobMessage> | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = await mod.getCloudflareContext({ async: true });
    const q = (ctx?.env as Record<string, unknown> | undefined)?.PARSE_QUEUE;
    return (q as QueueLike<ParseJobMessage> | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * getParseQueue — the factory the upload endpoint (P5) calls to obtain the
 * PARSE_QUEUE producer binding for the current request.
 *
 * The async parse pipeline is a HOSTED-only concern (self-host parses inline in
 * the upload route, no queue), so this throws when the binding is unavailable —
 * the same fail-closed shape getPdfStore() / getRepoForUser() use.
 */
export async function getParseQueue(): Promise<QueueLike<ParseJobMessage>> {
  const queue = await getParseQueueBinding();
  if (!queue) {
    throw new Error(
      "getParseQueue: PARSE_QUEUE binding unavailable (hosted mode requires the Workers runtime + a wired queue)"
    );
  }
  return queue;
}
