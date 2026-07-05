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
// the marketing homepage's waitlist signup (posted while signed out), and the
// public privacy policy (a legal page that must be readable signed-out).
// "/switch" (and the /switch-from-monarch SEO alias) is the public migration
// landing — readable signed-out so it's crawlable. Its /api/import* routes are
// NOT listed here, so they stay gated (a signed-out POST gets 401); the public
// view is a sales pitch + "sign in to import" CTA.
const PUBLIC_PATHS = [
  "/login",
  "/demo",
  "/api/auth",
  "/api/waitlist",
  "/about",
  "/mcp",
  "/privacy",
  "/terms",
  "/security",
  "/switch",
  "/switch-from-monarch",
  "/switching",
  "/how-it-works",
  "/pricing",
  "/blog",
];

// Hosted mode is selected at build/deploy time (PARE_DEPLOY_TARGET=hosted).
const HOSTED = process.env.PARE_DEPLOY_TARGET === "hosted";

// WAITLIST LAUNCH: when PARE_WAITLIST_ONLY=1, the hosted app is gated down to the
// public marketing landing ("/") + the waitlist signup + the privacy page. Login
// and every other app/API route redirect to "/", so the un-provisioned data plane
// (D1/R2/Queues) is never reached. Flip the var off + redeploy to restore the app.
const WAITLIST_ONLY = process.env.PARE_WAITLIST_ONLY === "1";
const WAITLIST_PUBLIC = ["/", "/demo", "/api/waitlist", "/about", "/mcp", "/privacy", "/terms", "/security", "/switch", "/switch-from-monarch", "/switching", "/how-it-works", "/pricing", "/blog"];

// The signing secret, read from the environment — the only source the Edge
// runtime can reach (no fs here). The Node API routes resolve the SAME value via
// lib/auth/session.ts, so cookies signed there verify here. Unset in self-host =>
// no valid session => everyone is treated as signed-out (secure default).
const AUTH_SECRET = process.env.PARE_AUTH_SECRET ?? null;

export async function middleware(request: NextRequest) {
  // HOSTED mode: retire the single-user gate entirely. Auth is per-request and
  // multi-tenant — every API route resolves the caller via getScopedRepo()
  // (cookie OR bearer) and returns 401 itself when unauthenticated. Pages get
  // an OPTIMISTIC gate here: signed-out visitors (no better-auth session
  // cookie) are redirected to /login instead of receiving the app shell.
  // Cookie PRESENCE only — the Edge runtime can't validate a better-auth
  // session (that needs D1); a forged cookie yields an empty shell whose data
  // fetches all 401, so real enforcement stays in the API layer. Without this,
  // app pages (notably /connect, a server component with real content)
  // rendered for anyone. The self-hosted gate below is untouched.
  if (HOSTED) {
    const { pathname } = request.nextUrl;
    if (WAITLIST_ONLY) {
      const allowed = WAITLIST_PUBLIC.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
      );
      // Everything else (login, dashboard, the API) bounces to the landing.
      return allowed ? NextResponse.next() : NextResponse.redirect(new URL("/", request.url));
    }
    // API routes pass through: bearer clients (mobile) need 401 JSON from the
    // route itself, never an HTML redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    // Production serves over https, so better-auth prefixes the cookie with
    // __Secure-; the bare name covers local/preview http.
    const hasSession =
      request.cookies.has("__Secure-better-auth.session_token") ||
      request.cookies.has("better-auth.session_token");
    // "/" is the public marketing landing; signed-in visitors go to the app.
    if (pathname === "/") {
      return hasSession
        ? NextResponse.redirect(new URL("/dashboard", request.url))
        : NextResponse.next();
    }
    if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return NextResponse.next();
    }
    if (!hasSession) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
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
  loginUrl.searchParams.set("from", pathname); // "/" already returned above
  return NextResponse.redirect(loginUrl);
}

// PWA surfaces (manifest, service worker, icons, offline fallback) are
// excluded: the browser and the SW fetch them without a session, and the SW
// must be able to precache /offline signed-out.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|icon-192.png|icon-512.png|icon-512-maskable.png|offline|demo-data.json).*)",
  ],
};
