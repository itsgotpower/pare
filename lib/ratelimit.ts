// ---------------------------------------------------------------------------
// Per-IP rate limiting over the Cloudflare Workers Rate Limiting binding.
//
// The unauthenticated public endpoints (waitlist signup, the better-auth
// sign-in/sign-up/reset catch-all) are the only ones a stranger can hammer, so
// they're the ones we throttle. The native binding (`env.<NAME>.limit({ key })`)
// is per-colo + best-effort — exactly the right tool for abuse mitigation (it is
// NOT a global, billing-grade counter, and doesn't need to be).
//
// Resolved the same lazy way as every other binding (lib/cf-bindings.ts), so when
// the binding is ABSENT — plain Node/dev, self-host, or the binding simply isn't
// wired — the limiter FAILS OPEN and the request passes through. Rate limiting is
// a hosted-only hardening layer; it must never break local dev or self-host.
//
// Wired in wrangler.toml as `[[unsafe.bindings]] type = "ratelimit"` (RL_AUTH,
// RL_WAITLIST). See lib/turnstile.ts for the complementary captcha layer.
// ---------------------------------------------------------------------------

// Minimal structural slice of the Rate Limiting binding (declared structurally so
// this file needs no @cloudflare/workers-types; tests can inject a stand-in).
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Trustworthy client IP for the rate-limit key. We use ONLY `cf-connecting-ip`,
 * which the Cloudflare edge sets and a client cannot forge (CF overwrites it).
 *
 * We deliberately do NOT fall back to `x-forwarded-for`: CF does not strip an
 * inbound XFF, so keying on it would let a client rotate the header to mint a
 * fresh bucket per request and defeat the limit entirely. When `cf-connecting-ip`
 * is absent (plain Node / dev / self-host) the rate-limit binding is also absent
 * and `allowRequest()` fails open, so the key is unused there — a constant is
 * fine, and lumping those requests into one bucket is the conservative choice.
 */
export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Consume one token for `key` against the named rate-limit binding.
 *
 * Returns true when the request is ALLOWED — either under the limit, OR the
 * binding is unavailable (dev/self-host) / the limiter errored. Returns false
 * only when a live binding reports the limit exceeded. Fail-open by design: a
 * limiter outage must not lock users out.
 */
export async function allowRequest(bindingName: string, key: string): Promise<boolean> {
  const { getBinding } = await import("./cf-bindings");
  const rl = await getBinding<RateLimitBinding>(bindingName);
  if (!rl) return true; // no binding wired (dev / self-host) -> pass through
  try {
    const { success } = await rl.limit({ key });
    return success;
  } catch {
    return true; // never block on limiter infra errors
  }
}

/** The 429 the public routes return when allowRequest() yields false. */
export function tooManyRequests(): Response {
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": "60" } }
  );
}
