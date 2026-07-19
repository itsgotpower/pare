import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";
import { withMcpCors, mcpCorsPreflight, isMcpOAuthPath } from "@/lib/auth/mcp-challenge";

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
  // Self-host never serves these sub-paths: 404 cleanly instead of throwing on
  // the missing D1 binding. The guard also keeps better-auth behind the dynamic
  // imports below, so the self-host runtime never loads it.
  if (!isHostedMode()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Throttle anonymous auth POSTs (sign-in/up/reset brute force) per IP. GETs
  // (e.g. get-session) are cheap reads and not limited.
  if (request.method === "POST") {
    if (!(await allowRequest("RL_AUTH", clientIp(request)))) return tooManyRequests();
  }
  const [{ createHostedAuth }, { toNextJsHandler }] = await Promise.all([
    import("@/lib/auth/hosted"),
    import("better-auth/next-js"),
  ]);
  const auth = createHostedAuth(await getD1());
  const { GET, POST } = toNextJsHandler(auth);
  const response = await (request.method === "GET" ? GET(request) : POST(request));
  // The MCP OAuth flow (discovery docs + /mcp/* register/token/jwks) is fetched
  // cross-origin by claude.ai's browser client, so those sub-paths need CORS.
  // The rest of the auth surface (sign-in/up/reset) is same-origin app traffic
  // and is left untouched. See isMcpOAuthPath / withMcpCors in mcp-challenge.ts.
  return isMcpOAuthPath(new URL(request.url).pathname) ? withMcpCors(response) : response;
}

// Preflight for the cross-origin MCP OAuth fetches (register/token send a
// Content-Type/Authorization header, so the browser preflights them). Only the
// MCP OAuth paths answer; everything else 404s as an unknown method.
export function OPTIONS(request: Request): Response {
  if (isHostedMode() && isMcpOAuthPath(new URL(request.url).pathname)) {
    return mcpCorsPreflight();
  }
  return new Response(null, { status: 404 });
}

export const GET = handler;
export const POST = handler;
