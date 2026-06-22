/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * The Cloudflare email() entrypoint for email-in — the THIN adapter around the
 * pure core (inbound.ts). It does the only part that needs the runtime: parse the
 * raw MIME in memory (postal-mime), pull out the PDF attachments + sender, hand the
 * decision to handleInboundEmail, then reply or silently discard. The raw message
 * is never stored, forwarded, or logged (Cloudflare Email Routing keeps no mailbox).
 *
 * Bindings come OFF `env` (NOT getCloudflareContext/process.env), which aren't
 * available in an email() invocation — exactly like the queue consumer.
 *
 * Wiring: invoked by adding `email` to the Worker's default-export handler
 * (worker.ts) alongside fetch/queue, with Email Routing routing *@in.pare.money to
 * the Worker. See internal/email-ingest-plan.md.
 */

import PostalMime from "postal-mime";
import { lookupUserByIngestToken } from "./token";
import { handleInboundEmail, type InboundDeps } from "./inbound";
import { sendIngestReceipt, sendIngestOverLimit, sendIngestNoPdf } from "./reply";
import { pdfStoreOverBucket } from "@/lib/storage/pdf-store";
import { jobStoreOverKv } from "@/lib/queue/job-store";
import { handleHostedUpload } from "@/lib/queue/upload-handler";

// Minimal slice of Cloudflare's ForwardableEmailMessage we use — structural (like
// the R2/KV slices elsewhere), so this needs no @cloudflare/workers-types.
export interface EmailMessageLike {
  readonly to: string;
  readonly from: string;
  readonly raw: ReadableStream<Uint8Array>;
}

// The env slice the email handler resolves bindings from — all OFF env.
export interface EmailWorkerEnv {
  DB: unknown; // D1 (pare-auth)   -> ingest_token lookup
  PDF_BUCKET: unknown; // R2         -> staged PDF bytes
  PARSE_JOBS: unknown; // KV         -> job status
  PARSE_QUEUE: unknown; // Queue     -> parse pipeline
}

export interface EmailCtxLike {
  waitUntil(promise: Promise<unknown>): void;
}

const PDF_MIME = "application/pdf";

/**
 * Process one inbound email. Parses the MIME in memory, runs the decision core,
 * and maps the outcome onto a reply or a silent discard. Never throws on bad mail.
 */
export async function handleEmailMessage(
  message: EmailMessageLike,
  env: EmailWorkerEnv,
  ctx: EmailCtxLike
): Promise<void> {
  // Parse the raw MIME in memory; we keep ONLY the PDF attachments + sender.
  const parsed = await new PostalMime().parse(message.raw);
  const pdfs = (parsed.attachments ?? [])
    .filter(
      (a) =>
        a.mimeType === PDF_MIME || (a.filename ?? "").toLowerCase().endsWith(".pdf")
    )
    .map((a) => ({
      filename: a.filename || "statement.pdf",
      bytes:
        typeof a.content === "string"
          ? new TextEncoder().encode(a.content)
          : new Uint8Array(a.content),
    }));

  const sender = parsed.from?.address || message.from;

  const deps: InboundDeps = {
    lookupUser: (token) => lookupUserByIngestToken(token, env.DB as never),
    upload: ({ userId, filename, bytes }) =>
      handleHostedUpload(
        { userId, filename, bytes },
        {
          pdfStore: pdfStoreOverBucket(env.PDF_BUCKET as never),
          jobStore: jobStoreOverKv(env.PARSE_JOBS as never),
          queue: env.PARSE_QUEUE as never,
        }
      ),
    // Plan gate (enforceStatementUpload) intentionally omitted: it resolves D1 via
    // getCloudflareContext, unavailable in email(). Wiring an env-threaded variant
    // is a follow-up; until then email-in is unmetered.
  };

  const outcome = await handleInboundEmail({ to: message.to, pdfs }, deps);

  switch (outcome.action) {
    case "accepted":
      ctx.waitUntil(sendIngestReceipt(sender, outcome.jobs.map((j) => j.filename)));
      break;
    case "over-limit":
      ctx.waitUntil(sendIngestOverLimit(sender));
      break;
    case "rejected":
      // unknown-address -> silently discard (never reveal which addresses exist).
      // no-pdf / no-valid-pdf -> the token resolved (a real user), so nudge them.
      if (outcome.reason !== "unknown-address") {
        ctx.waitUntil(sendIngestNoPdf(sender));
      }
      break;
  }
}
