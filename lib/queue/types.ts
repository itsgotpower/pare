// ---------------------------------------------------------------------------
// Async parse pipeline — the shared types for the Cloudflare Queue that decouples
// "a PDF was uploaded" (the request, P5) from "parse it + write the rows" (this
// background job, P4). The upload route (P5) stores the PDF in R2, records a
// queued job, and enqueues ONE message; the queue consumer (lib/queue/consumer.ts)
// drains it.
//
// Mirrors the structural-typing convention used across this codebase (see
// DoNamespaceLike in lib/repo/index.ts and R2BucketLike in lib/storage/pdf-store.ts):
// we declare the minimal slice of Cloudflare's Queue API we depend on, so this
// module needs no @cloudflare/workers-types and tests can inject a stand-in
// (miniflare's real Queue / a fake).
// ---------------------------------------------------------------------------

/**
 * The parse-job message body. Structured-clone-safe (all primitives) so it
 * crosses the Queue boundary unchanged. Deliberately tiny: the PDF bytes are NOT
 * inlined (a queue message is capped at 128 KB and statements can exceed that) —
 * the bytes live in R2 under `r2Key`, fetched by the consumer.
 *
 *   userId   — owner of the upload; selects the per-user DO AND the R2 key prefix.
 *   r2Key    — PdfStore key returned by PdfStore.put(); `u/<userId>/...`.
 *   filename — original upload name, stored on the statements row.
 *   jobId    — the JobStore record this message corresponds to; the consumer
 *              flips it queued -> parsing -> done|failed and P5's status endpoint
 *              reads it back.
 *   planId   — the caller's billing plan, resolved AT UPLOAD TIME by the route
 *              (cloud/billing/gate.ts) and carried here because the consumer
 *              cannot reach D1/process.env inside a queue() invocation. Present
 *              ⇒ the consumer enforces the per-plan ACCOUNT cap post-parse;
 *              absent (cloud layer off, email-in, older in-flight messages) ⇒
 *              no account gating. Kept a plain string so this AGPL module has
 *              no compile-time dependency on the proprietary cloud/ layer.
 */
export interface ParseJobMessage {
  userId: string;
  r2Key: string;
  filename: string;
  jobId: string;
  planId?: string;
}

// --- Minimal structural slice of Cloudflare's Queue producer API ------------

/** Per-message send options we use (delaySeconds etc. are unused for now). */
export interface QueueSendOptions {
  contentType?: "json" | "text" | "bytes" | "v8";
  delaySeconds?: number;
}

/**
 * The producer binding (env.PARSE_QUEUE). Real binding wired in P6; declared
 * structurally so the producer module and its tests don't depend on the Workers
 * runtime types.
 */
export interface QueueLike<Body = unknown> {
  send(body: Body, options?: QueueSendOptions): Promise<void>;
}

// --- Minimal structural slice of the consumer-side Queue API ----------------

export interface QueueRetryOptions {
  delaySeconds?: number;
}

/** One delivered message. Mirrors Cloudflare's `Message<Body>`. */
export interface QueueMessageLike<Body = unknown> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: Body;
  /** Delivery attempt count; starts at 1 and climbs on each retry. */
  readonly attempts: number;
  ack(): void;
  retry(options?: QueueRetryOptions): void;
}

/** A batch of delivered messages. Mirrors Cloudflare's `MessageBatch<Body>`. */
export interface QueueMessageBatchLike<Body = unknown> {
  readonly queue: string;
  readonly messages: readonly QueueMessageLike<Body>[];
  ackAll(): void;
  retryAll(options?: QueueRetryOptions): void;
}
