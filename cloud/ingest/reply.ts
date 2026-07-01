/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Reply emails for the email-in path, over Resend (fetch-based, runs on Workers).
 * Mirrors lib/auth/email.ts: RESEND_API_KEY-gated — when unset (dev/test) we log
 * instead of sending, so the flow stays exercisable without a live key.
 *
 * These close the retention loop: the user forwards a statement and gets a "got
 * it / parsing" reply (and a nudge when there was nothing to parse). The receipt
 * deliberately reaffirms the privacy promise — we don't keep the mail or the PDF.
 */

import { Resend } from "resend";

const FROM =
  process.env.PARE_INGEST_FROM ||
  process.env.AUTH_EMAIL_FROM ||
  "Pare <statements@pare.money>";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

async function send(to: string, subject: string, text: string): Promise<void> {
  const resend = client();
  if (!resend) {
    console.warn(`[ingest/reply] RESEND_API_KEY unset; would email ${to}: ${subject}`);
    return;
  }
  // resend@6 returns { data, error } and does NOT throw on API errors — and this
  // runs inside ctx.waitUntil, so an unlogged failure would vanish silently.
  const { error } = await resend.emails.send({ from: FROM, to, subject, text });
  if (error) {
    console.error(`[ingest/reply] send failed ("${subject}"): ${error.message}`);
  }
}

/** Acknowledge accepted statement(s) and reaffirm the no-retention promise. */
export async function sendIngestReceipt(to: string, filenames: string[]): Promise<void> {
  const what =
    filenames.length === 1 ? "your statement" : `${filenames.length} statements`;
  await send(
    to,
    "Got your statement — parsing now",
    `Thanks — we received ${what} (${filenames.join(", ")}) and we're parsing it now.\n\n` +
      `The transactions will appear in your Pare account in a moment.\n\n` +
      `We don't keep the email or the PDF: once it's parsed, the file is deleted.`
  );
}

/** The caller hit their plan's monthly upload limit; nothing was added. */
export async function sendIngestOverLimit(to: string): Promise<void> {
  await send(
    to,
    "Statement not added — plan limit reached",
    `We received your statement, but your plan's monthly upload limit is reached, ` +
      `so we didn't add it.\n\n` +
      `Upgrade in the app to lift the limit, then forward it again.`
  );
}

/** A known user emailed in with no usable PDF — gentle nudge (never to strangers). */
export async function sendIngestNoPdf(to: string): Promise<void> {
  await send(
    to,
    "We couldn't find a statement to add",
    `We received your email but didn't find a PDF statement attached, so there was ` +
      `nothing to add.\n\n` +
      `Forward the bank email with the statement PDF attached, or download the PDF ` +
      `and attach it.`
  );
}
