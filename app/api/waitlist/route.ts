import { NextRequest } from "next/server";
import { getSharedRepo } from "@/lib/repo/scoped";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { csvField } from "@/lib/csv";

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

  // Reject oversized input before it crosses the RPC to the shared DO (RFC 5321
  // caps a valid address at 254 chars). joinWaitlist re-checks as defense-in-depth.
  if (email.length > 254) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
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

// Admin export of captured signups. The waitlist persists to a shared Durable
// Object (hosted) / the file DB (self-host) with no read-back UI, so this is how
// the operator views the list. Gated on a shared secret, WAITLIST_ADMIN_TOKEN:
// when it's UNSET the endpoint is DISABLED and returns 404 (so it doesn't exist
// on an unconfigured deploy and the path stays undiscoverable). Pass the token
// as `Authorization: Bearer <tok>` or `?token=<tok>`. Default output is CSV
// (opens straight in Sheets/Excel); `?format=json` returns JSON.
//
// Set it once with: npx wrangler secret put WAITLIST_ADMIN_TOKEN
export async function GET(request: NextRequest) {
  const expected = process.env.WAITLIST_ADMIN_TOKEN;
  // Disabled until a token is configured — and a 404 (not 401) so the route is
  // indistinguishable from "no such endpoint" when unconfigured.
  if (!expected) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ??
    "";
  if (!safeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const repo = await getSharedRepo();
  const entries = await repo.waitlist.list();

  if (url.searchParams.get("format") === "json") {
    return Response.json({ count: entries.length, entries });
  }

  const rows = entries.map((e) =>
    [e.email, e.source, e.created_at].map(csvField).join(",")
  );
  const csv = ["email,source,created_at", ...rows].join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="waitlist.csv"',
    },
  });
}

// Length-aware constant-time-ish string compare so the token check doesn't leak
// via early-exit timing. Runtime-agnostic (no node:crypto) — runs on the Edge/
// Workers target too.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
