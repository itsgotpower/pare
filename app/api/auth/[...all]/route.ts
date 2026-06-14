import { toNextJsHandler } from "better-auth/next-js";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";

// HOSTED-mode better-auth endpoints: /api/auth/sign-up/email,
// /api/auth/sign-in/email, /api/auth/request-password-reset, etc.
//
// The exact `/api/auth` path is still served by the single-user gate
// (app/api/auth/route.ts); this catch-all only matches deeper paths, so the two
// coexist. In self-hosted mode nothing posts to these sub-paths.
//
// The better-auth instance is built per-request from the D1 binding (the
// binding only exists in the Worker request scope), then handed to
// toNextJsHandler.
//
// PHASE 4 — these are the unauthenticated auth mutations (sign-in/up/reset), so
// every POST is rate-limited per IP (RL_AUTH, fail-open when unwired). Turnstile
// for these endpoints is handled INSIDE better-auth by its `captcha` plugin
// (lib/auth/hosted.ts, gated on TURNSTILE_SECRET_KEY) — the client sends the
// token as an `x-captcha-response` header — so it isn't repeated here.

async function handler(request: Request): Promise<Response> {
  // Throttle anonymous auth POSTs (sign-in/up/reset brute force) per IP. GETs
  // (e.g. get-session) are cheap reads and not limited.
  if (request.method === "POST") {
    if (!(await allowRequest("RL_AUTH", clientIp(request)))) return tooManyRequests();
  }
  const auth = createHostedAuth(await getD1());
  const { GET, POST } = toNextJsHandler(auth);
  return request.method === "GET" ? GET(request) : POST(request);
}

export const GET = handler;
export const POST = handler;
