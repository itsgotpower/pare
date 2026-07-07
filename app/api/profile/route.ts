import { NextRequest } from "next/server";
import { isHostedMode } from "@/lib/auth/resolve";
import { getScopedRepo } from "@/lib/repo/scoped";

// GET /api/profile — the signed-in user's profile + data health, for the
// /profile page. Works in BOTH deploy modes; the profile page always calls this
// (never the self-host-only /api/auth GET, which 404s in hosted and used to send
// the hosted profile page into a redirect loop).
//
// Mode-specific modules are dynamically imported inside their branch so the
// hosted Workers bundle never pulls in better-sqlite3 and self-host never needs
// the D1/better-auth stack.
//
// Shape (both modes):
//   { configured, authenticated, profile?: {
//       display_name, email, email_verified, created_at,
//       password_changed_at, health } }
// email/email_verified are null in self-host (no email identity); the client
// uses email !== null to know it's a hosted account.

export async function GET(request: NextRequest) {
  if (isHostedMode()) {
    const { createHostedAuth } = await import("@/lib/auth/hosted");
    const { getD1 } = await import("@/lib/auth/d1");
    const auth = createHostedAuth(await getD1());
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return Response.json({ configured: true, authenticated: false });
    }
    const repo = await getScopedRepo(request);
    const u = session.user;
    const created = u.createdAt ? new Date(u.createdAt).toISOString() : null;
    return Response.json({
      configured: true,
      authenticated: true,
      profile: {
        display_name: u.name ?? "",
        email: u.email ?? null,
        email_verified: !!u.emailVerified,
        created_at: created,
        // Hosted passwords are managed by better-auth (reset via email); there's
        // no per-row "changed at" to surface here.
        password_changed_at: null,
        health: repo ? await repo.profile.dataHealth() : null,
      },
    });
  }

  // Self-host: mirror the existing /api/auth GET (single-user HMAC gate). The
  // scoped repo is unauth'd in self-host (getScopedRepo returns getRepo()), so
  // we verify the session cookie ourselves before returning any data.
  const { getUser, isConfigured } = await import("@/lib/auth/user");
  const { cookies } = await import("next/headers");
  const { verifySessionToken, SESSION_COOKIE } = await import("@/lib/auth/session");

  const configured = isConfigured();
  const store = await cookies();
  const authed =
    configured && (await verifySessionToken(store.get(SESSION_COOKIE)?.value));
  if (!authed) {
    return Response.json({ configured, authenticated: false });
  }

  const repo = await getScopedRepo(request);
  const user = getUser()!;
  return Response.json({
    configured: true,
    authenticated: true,
    profile: {
      ...user,
      email: null,
      email_verified: null,
      health: repo ? await repo.profile.dataHealth() : null,
    },
  });
}
