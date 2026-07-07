import { NextRequest } from "next/server";
import { captureError } from "@/lib/sentry";
import { allowRequest, clientIp } from "@/lib/ratelimit";

// Client-error beacon sink. The React error boundaries POST a trimmed payload
// (message/stack/digest/url) here; we redact, forward to Sentry best-effort, and
// structured-log (so the error is captured in Cloudflare logs even if the Sentry
// request scope isn't active for this handler). NOTHING is stored. Always returns
// 204 so the beacon never surfaces an error to the user.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function clean(value: unknown, max = 4000): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(EMAIL_RE, "[email]").slice(0, max);
}

export async function POST(request: NextRequest) {
  // Unauthenticated beacon (any /api/* passes the hosted middleware; this route
  // does its own gating). Throttle per client IP so an anonymous caller can't
  // burn the Sentry event quota or inflate Cloudflare log volume. Uses its OWN
  // rate-limit namespace (RL_BEACON, NOT RL_AUTH) so an error-storm from one IP
  // can't drain the auth budget and 429 that user's sign-in. Fail-open when the
  // binding is absent (dev/self-host). Over-limit posts are silently dropped with
  // the same 204 the handler always returns, so the beacon never surfaces.
  if (!(await allowRequest("RL_BEACON", clientIp(request)))) {
    return new Response(null, { status: 204 });
  }

  let payload: { message?: string; stack?: string; digest?: string; url?: string } = {};
  try {
    payload = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const message = clean(payload.message, 1000) || "client error";
  const url = clean(payload.url, 500);
  const error = new Error(message);
  const stack = clean(payload.stack);
  if (stack) error.stack = stack;

  void captureError(error, { source: "client", digest: payload.digest, url });
  console.error(
    JSON.stringify({ event: "client_error", message, digest: payload.digest, url })
  );

  return new Response(null, { status: 204 });
}
