// ---------------------------------------------------------------------------
// Cloudflare Turnstile — server-side token verification for user-facing forms.
//
// FAIL-OPEN UNTIL CONFIGURED: when TURNSTILE_SECRET_KEY is unset the check is
// SKIPPED, so local dev and self-host (which never render the widget) keep
// working with no captcha. When the secret IS set, a missing or invalid token
// fails CLOSED (the request is rejected). This mirrors the rate-limiter's
// fail-open posture (lib/ratelimit.ts): hardening that's inert until provisioned.
//
// The companion client widget is components/turnstile.tsx (gated on the PUBLIC
// site key NEXT_PUBLIC_TURNSTILE_SITE_KEY). For the better-auth endpoints,
// verification is instead handled by better-auth's own `captcha` plugin
// (lib/auth/hosted.ts), also gated on TURNSTILE_SECRET_KEY — this module covers
// the NON-better-auth forms (the waitlist) plus the self-host login.
// ---------------------------------------------------------------------------

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  /** True if the caller may proceed (verified, or check not enforced). */
  ok: boolean;
  /** True when no secret is configured, so the check was not enforced. */
  skipped: boolean;
  /** Human-readable reason when ok === false (or a soft note when skipped). */
  error?: string;
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * @param token the `cf-turnstile-response` value from the client widget
 * @param ip    optional remote IP (binds the token to the requester)
 */
export async function verifyTurnstile(
  token: string | undefined,
  ip?: string
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false, error: "Captcha required." };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true, skipped: false };
    return { ok: false, skipped: false, error: "Captcha verification failed." };
  } catch {
    // Siteverify unreachable (Cloudflare-side blip / network). Fail OPEN so an
    // outage doesn't lock everyone out of signup — the rate limiter still caps
    // abuse. Marked skipped:true so callers can log the degradation.
    return { ok: true, skipped: true, error: "verify_unreachable" };
  }
}

/** Whether server-side Turnstile enforcement is configured. */
export function turnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}
