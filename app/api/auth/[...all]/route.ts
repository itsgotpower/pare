import { toNextJsHandler } from "better-auth/next-js";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";

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

async function handler(request: Request): Promise<Response> {
  const auth = createHostedAuth(await getD1());
  const { GET, POST } = toNextJsHandler(auth);
  return request.method === "GET" ? GET(request) : POST(request);
}

export const GET = handler;
export const POST = handler;
