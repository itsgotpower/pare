import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Public paths: the login page (checks setup state + signs in), its auth API,
// and the marketing homepage's waitlist signup (posted while signed out).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/waitlist"];

// Hosted mode is selected at build/deploy time (PARSE_DEPLOY_TARGET=hosted).
const HOSTED = process.env.PARSE_DEPLOY_TARGET === "hosted";

export function proxy(request: NextRequest) {
  // HOSTED mode: retire the single-user gate entirely. Auth is per-request and
  // multi-tenant — every API route resolves the caller via getScopedRepo()
  // (cookie OR bearer) and returns 401 itself when unauthenticated, and pages
  // gate via the account system. Crucially, NOT running middleware here also
  // unblocks the @opennextjs/cloudflare build, which (per Session 1) cannot
  // bundle this Node-runtime middleware. The self-hosted gate below is untouched.
  if (HOSTED) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const authed = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

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
