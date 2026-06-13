import { verifySessionToken, SESSION_COOKIE } from "./session";
import type { HostedAuth } from "./hosted";

// ============================================================================
// resolveUser — THE auth primitive the rest of the app uses.
// ============================================================================
//
//   resolveUser(request) -> Promise<{ userId: string } | null>
//
// Given an incoming Request, return who is authenticated, or null if no one.
// It works for BOTH session cookies AND bearer tokens, and for BOTH deploy
// targets. This signature is the stable contract Session 6 (per-user data
// routing) depends on — Session 6 takes the returned `userId` and scopes the
// Repo to that user. KEEP THIS SIGNATURE STABLE.
//
//   - Resolves to `{ userId }` for an authenticated request.
//   - Resolves to `null` for an anonymous / invalid / expired request.
//   - Never throws on a bad/absent credential; only unexpected infra errors
//     propagate.
//
// Two implementations, selected by deploy target (PARSE_DEPLOY_TARGET):
//
//   hosted      -> better-auth on D1. Cookies AND bearer tokens both flow
//                  through `auth.api.getSession({ headers })`: better-auth
//                  reads the session cookie OR an `Authorization: Bearer`
//                  token (bearer plugin) from the SAME headers and returns the
//                  session's user. userId is the better-auth user id (a uuid-ish
//                  text id from the `user` table).
//
//   self-hosted -> the existing single-user gate (stateless HMAC cookie in
//                  lib/auth/session.ts). There is exactly one account, so a
//                  valid cookie resolves to the fixed SINGLE_USER_ID. Bearer
//                  tokens are not part of self-hosted mode (no mobile multi-user
//                  story); only the cookie is honored.
//
// On Cloudflare Workers the D1 binding (and thus the better-auth instance) only
// exists inside the request scope, so the hosted path needs that per-request
// instance handed to it — see `resolveUserHosted(request, auth)`. The default
// `resolveUser(request)` covers the self-hosted/local path with zero wiring;
// the hosted entrypoint (route / proxy on Workers) calls `resolveUserHosted`
// with the request-scoped auth.

export interface ResolvedUser {
  userId: string;
}

// Fixed id for the lone account in self-hosted mode (app_user row id = 1).
export const SINGLE_USER_ID = "self-hosted-user";

export function isHostedMode(): boolean {
  return process.env.PARSE_DEPLOY_TARGET === "hosted";
}

/**
 * Self-hosted resolver: verify the stateless HMAC session cookie. One account,
 * so any valid cookie maps to SINGLE_USER_ID.
 */
export function resolveUserSelfHosted(request: Request): ResolvedUser | null {
  const token = readCookie(request, SESSION_COOKIE);
  return verifySessionToken(token) ? { userId: SINGLE_USER_ID } : null;
}

/**
 * Hosted resolver: delegate to better-auth, which resolves a session from
 * EITHER the session cookie OR an `Authorization: Bearer <token>` header
 * (bearer plugin) present on the request. `auth` is the request-scoped instance
 * built from the D1 binding (createHostedAuth(env.DB)).
 */
export async function resolveUserHosted(
  request: Request,
  auth: HostedAuth
): Promise<ResolvedUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  return { userId: session.user.id };
}

/**
 * resolveUser — given a request, who is the authenticated user?
 *
 * Default entry point. In self-hosted/local mode it needs nothing else. In
 * hosted mode, pass the request-scoped better-auth instance as the second arg
 * (the Worker has the D1 binding); without it in hosted mode we can't talk to
 * D1, so we fail closed (return null) and warn.
 */
export async function resolveUser(
  request: Request,
  hostedAuth?: HostedAuth
): Promise<ResolvedUser | null> {
  if (isHostedMode()) {
    if (!hostedAuth) {
      console.warn(
        "[auth] resolveUser called in hosted mode without a request-scoped auth instance; failing closed"
      );
      return null;
    }
    return resolveUserHosted(request, hostedAuth);
  }
  return resolveUserSelfHosted(request);
}

// Minimal Cookie-header parser (avoids a dependency; the Workers/Next Request
// exposes cookies only via the raw header here).
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
