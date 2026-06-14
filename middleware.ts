import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session-token";

// EDGE middleware (NOT the Node `proxy` convention). Next 16 renamed middleware
// → proxy, but `proxy` is locked to the Node.js runtime, which @opennextjs/
// cloudflare cannot bundle ("Node.js middleware is not currently supported") —
// so cf:build/cf:deploy fail. Keeping the gate as `middleware.ts` keeps it on the
// Edge runtime, which OpenNext DOES support. The Edge runtime forbids node:fs /
// node:crypto, hence the WebCrypto HMAC + env secret below (see lib/auth/
// session-token.ts). Self-host runs this same Edge gate.

// Public paths: the login page (checks setup state + signs in), its auth API,
// and the marketing homepage's waitlist signup (posted while signed out).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/waitlist"];

// Hosted mode is selected at build/deploy time (PARE_DEPLOY_TARGET=hosted).
const HOSTED = process.env.PARE_DEPLOY_TARGET === "hosted";

// The signing secret, read from the environment — the only source the Edge
// runtime can reach (no fs here). The Node API routes resolve the SAME value via
// lib/auth/session.ts, so cookies signed there verify here. Unset in self-host =>
// no valid session => everyone is treated as signed-out (secure default).
const AUTH_SECRET = process.env.PARE_AUTH_SECRET ?? null;

export async function middleware(request: NextRequest) {
  // HOSTED mode: retire the single-user gate entirely. Auth is per-request and
  // multi-tenant — every API route resolves the caller via getScopedRepo()
  // (cookie OR bearer) and returns 401 itself when unauthenticated, and pages
  // gate via the account system. The self-hosted gate below is untouched.
  if (HOSTED) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const authed = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    AUTH_SECRET
  );

  // "/" is the public marketing landing for signed-out visitors. Signed-in
  // users don't need a sales pitch — send them straight into the app.
  if (pathname === "/") {
    return authed
      ? NextResponse.redirect(new URL("/dashboard", request.url))
      : NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (authed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
