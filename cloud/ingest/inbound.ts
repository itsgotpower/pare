/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * handleInboundEmail — the pure core of the email-in path. The Cloudflare email()
 * entrypoint (cloud/ingest/email-worker.ts) does the only part that needs the
 * runtime — parse the raw MIME in memory and pull out the `to` address + PDF
 * attachments — then calls this with everything injected, so the full decision
 * tree is unit-testable without Cloudflare.
 *
 * RETENTION (by construction):
 *   - This core never sees, stores, or forwards the RAW email; it only receives
 *     already-extracted PDF bytes. Cloudflare Email Routing has no mailbox — the
 *     raw message is discarded when the entrypoint returns. Nothing to "destroy".
 *   - Unknown addresses and PDF-less mail are rejected BEFORE anything touches
 *     storage (zero footprint for junk / misfires).
 *   - An accepted PDF rides the existing upload pipeline, which deletes it from R2
 *     after parse — including the "couldn't parse / not a statement" 0-transaction
 *     case (lib/queue/consumer.ts). An R2 lifecycle rule on PDF_BUCKET is the
 *     backstop so even a parser-crash orphan can't outlive ~a day.
 */

export interface InboundDeps {
  /** token (address local-part) -> userId, or null. The ONLY trust boundary. */
  lookupUser: (token: string) => Promise<string | null>;
  /** Stage one PDF on the existing pipeline (handleHostedUpload). */
  upload: (input: {
    userId: string;
    filename: string;
    bytes: Uint8Array;
  }) => Promise<{ jobId: string }>;
  /** Optional plan gate (cloud/billing enforceStatementUpload). Omit to skip. */
  enforceUpload?: (userId: string) => Promise<{ allowed: boolean; reason?: string }>;
}

export interface InboundEmail {
  /** Recipient: <token>@<INGEST_DOMAIN>. */
  to: string;
  /** PDF attachments already extracted from the MIME body (raw mail discarded). */
  pdfs: { filename: string; bytes: Uint8Array }[];
}

export type InboundOutcome =
  | { action: "rejected"; reason: "unknown-address" | "no-pdf" | "no-valid-pdf" }
  | { action: "over-limit"; userId: string }
  | { action: "accepted"; userId: string; jobs: { filename: string; jobId: string }[] };

/** Extract the local-part token from an address (`tok@in.pare.money` -> `tok`). */
export function addressToken(address: string): string {
  return (address.split("@")[0] ?? "").trim().toLowerCase();
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF" — the same magic-byte guard the upload route applies.
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

/**
 * Decide what to do with one inbound email. Resolves to an outcome the entrypoint
 * maps onto Cloudflare actions (silently discard / reply / done). Never throws on
 * bad input — only `deps` infra errors propagate.
 */
export async function handleInboundEmail(
  email: InboundEmail,
  deps: InboundDeps
): Promise<InboundOutcome> {
  const userId = await deps.lookupUser(addressToken(email.to));
  // Unknown address: reject WITHOUT revealing whether any address is valid — the
  // entrypoint silently discards rather than bouncing.
  if (!userId) return { action: "rejected", reason: "unknown-address" };
  if (email.pdfs.length === 0) return { action: "rejected", reason: "no-pdf" };

  if (deps.enforceUpload) {
    const gate = await deps.enforceUpload(userId);
    if (!gate.allowed) return { action: "over-limit", userId };
  }

  const jobs: { filename: string; jobId: string }[] = [];
  for (const pdf of email.pdfs) {
    // A .pdf-named non-PDF never enters the pipeline (e.g. an image renamed .pdf).
    if (!looksLikePdf(pdf.bytes)) continue;
    const { jobId } = await deps.upload({
      userId,
      filename: pdf.filename,
      bytes: pdf.bytes,
    });
    jobs.push({ filename: pdf.filename, jobId });
  }
  if (jobs.length === 0) return { action: "rejected", reason: "no-valid-pdf" };
  return { action: "accepted", userId, jobs };
}
