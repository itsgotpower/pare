import { NextRequest } from "next/server";
import { getSharedRepo } from "@/lib/repo/scoped";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";

// Public endpoint (allowlisted in the auth gate) — the marketing homepage posts
// here while the visitor is signed out. Because it's anonymous and public, it's a
// prime abuse target, so it carries two Phase-4 guards (both fail-open until
// provisioned): a per-IP rate limit (RL_WAITLIST) and Turnstile verification.
export async function POST(request: NextRequest) {
  // 1. Per-IP rate limit (no-op when the binding is absent — dev/self-host).
  const ip = clientIp(request);
  if (!(await allowRequest("RL_WAITLIST", ip))) return tooManyRequests();

  let email = "";
  let turnstileToken: string | undefined;
  try {
    const body = await request.json();
    email = typeof body?.email === "string" ? body.email : "";
    turnstileToken =
      typeof body?.turnstileToken === "string" ? body.turnstileToken : undefined;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // 2. Turnstile (skipped when TURNSTILE_SECRET_KEY is unset).
  const captcha = await verifyTurnstile(turnstileToken, ip);
  if (!captcha.ok) {
    return Response.json({ error: captcha.error ?? "Captcha failed." }, { status: 400 });
  }

  const repo = await getSharedRepo();
  const result = await repo.waitlist.join(email);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ success: true, alreadyJoined: result.alreadyJoined });
}
