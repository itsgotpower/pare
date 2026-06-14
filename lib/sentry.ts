// ---------------------------------------------------------------------------
// Error tracking (Sentry) — shared config + PII redaction.
//
// The Worker entry (worker.ts) wraps its handler with Sentry.withSentry(), which
// captures unhandled errors from the fetch + queue handlers with request context.
// Handled errors we care about (queue-consumer failures, client-side errors via
// the /api/monitoring beacon) call captureError() explicitly.
//
// GATED ON SENTRY_DSN: when the DSN is unset the SDK initialises as a no-op and
// nothing is sent — so dev, self-host, and un-provisioned deploys are unaffected.
// The DSN is a SECRET (wrangler secret put SENTRY_DSN), never committed.
//
// PII POSTURE — this app handles financial data, so the redaction is strict:
//   - sendDefaultPii: false (no IPs, cookies, or user records auto-attached)
//   - beforeSend strips Authorization / Cookie / captcha headers, request bodies,
//     and query strings, and masks any email addresses that reach a message,
//     exception value, or breadcrumb.
// ---------------------------------------------------------------------------

import type { CloudflareOptions, ErrorEvent } from "@sentry/cloudflare";

interface SentryEnv {
  SENTRY_DSN?: string;
}

// Request headers that must never leave the Worker in an error event.
const REDACT_HEADERS = ["authorization", "cookie", "set-cookie", "x-captcha-response"];

// Conservative email matcher — masks addresses anywhere they slip into text.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function maskEmails(value: string | undefined): string | undefined {
  return typeof value === "string" ? value.replace(EMAIL_RE, "[email]") : value;
}

/** Strip sensitive data from a Sentry event before it's sent. Exported for tests. */
export function redactEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    if (request.headers && typeof request.headers === "object") {
      const headers = request.headers as Record<string, unknown>;
      for (const key of Object.keys(headers)) {
        if (REDACT_HEADERS.includes(key.toLowerCase())) delete headers[key];
      }
    }
    // Cookies + bodies + query strings can carry tokens/emails — drop them whole.
    delete (request as Record<string, unknown>).cookies;
    if (typeof request.query_string === "string") request.query_string = "[redacted]";
    if (request.data !== undefined) request.data = "[redacted]";
  }

  if (event.message) event.message = maskEmails(event.message)!;
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskEmails(exception.value)!;
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = maskEmails(crumb.message)!;
  }
  // Never attach a resolved user identity.
  delete (event as unknown as Record<string, unknown>).user;

  return event;
}

/**
 * Sentry options for the Worker. `env` carries the SENTRY_DSN binding inside the
 * Worker; falls back to process.env for dev/Node. Returns a no-op config (no DSN)
 * when unset, so withSentry stays inert until provisioned.
 */
export function sentryOptions(env?: SentryEnv): CloudflareOptions {
  const dsn =
    env?.SENTRY_DSN ?? (typeof process !== "undefined" ? process.env.SENTRY_DSN : undefined);
  return {
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only — no performance spans (cost control)
    beforeSend: (event) => redactEvent(event as ErrorEvent),
  };
}

/**
 * Best-effort capture for HANDLED errors (queue consumer, client beacon). Lazily
 * imports the SDK and swallows any failure, so it's safe to call from Node tests
 * and self-host where Sentry is never initialised. No-op when the DSN is unset
 * (the SDK simply doesn't transmit).
 */
export async function captureError(
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    const Sentry = await import("@sentry/cloudflare");
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // SDK absent / not initialised — swallow.
  }
}
