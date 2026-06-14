import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getScopedRepo } from "@/lib/repo/scoped";
import { isHostedMode } from "@/lib/auth/resolve";
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/session";
import {
  getUser,
  isConfigured,
  createUser,
  verifyPassword,
  updateDisplayName,
  changePassword,
} from "@/lib/auth/user";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
};

async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return await verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

// This is the SELF-HOSTED single-user gate (scrypt + HMAC cookie, better-sqlite3,
// node:fs secret). In hosted mode it must NOT run — it would 500 on Workers
// (better-sqlite3 can't load) and mixes auth domains with better-auth. Hosted auth
// lives at /api/auth/[...all]; this exact path returns 404 there.
function hostedDisabled(): Response {
  return Response.json(
    { error: "Not found (hosted mode uses /api/auth/* via better-auth)" },
    { status: 404 }
  );
}

export async function GET(request: NextRequest) {
  if (isHostedMode()) return hostedDisabled();
  const configured = isConfigured();
  const authenticated = configured && (await isAuthenticated());

  if (!authenticated) {
    return Response.json({ configured, authenticated: false });
  }

  // Self-hosted single-user profile + data-health. getScopedRepo returns the
  // file-backed repo here (this GET runs behind the self-hosted gate); in hosted
  // mode the dashboard reads health via the per-user routes instead.
  const repo = await getScopedRepo(request);
  const user = getUser()!;
  return Response.json({
    configured: true,
    authenticated: true,
    profile: { ...user, health: repo ? await repo.profile.dataHealth() : null },
  });
}

export async function POST(request: NextRequest) {
  if (isHostedMode()) return hostedDisabled();
  const body = await request.json().catch(() => ({}));
  const store = await cookies();

  switch (body.action) {
    case "setup": {
      if (isConfigured()) {
        return Response.json({ error: "Already configured" }, { status: 409 });
      }
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length < 8) {
        return Response.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 }
        );
      }
      createUser(String(body.display_name || "").trim(), password);
      store.set(SESSION_COOKIE, await createSessionToken(), COOKIE_OPTS);
      return Response.json({ success: true });
    }

    case "login": {
      if (!isConfigured()) {
        return Response.json({ error: "Not configured" }, { status: 409 });
      }
      if (!verifyPassword(String(body.password ?? ""))) {
        // Blunt the obvious brute-force loop; scrypt already adds ~100ms.
        await new Promise((r) => setTimeout(r, 500));
        return Response.json({ error: "Incorrect password" }, { status: 401 });
      }
      store.set(SESSION_COOKIE, await createSessionToken(), COOKIE_OPTS);
      return Response.json({ success: true });
    }

    case "logout": {
      store.delete(SESSION_COOKIE);
      return Response.json({ success: true });
    }

    case "update_profile": {
      if (!(await isAuthenticated())) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      updateDisplayName(String(body.display_name || "").trim());
      return Response.json({ success: true });
    }

    case "change_password": {
      if (!(await isAuthenticated())) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!verifyPassword(String(body.current_password ?? ""))) {
        await new Promise((r) => setTimeout(r, 500));
        return Response.json(
          { error: "Current password is incorrect" },
          { status: 401 }
        );
      }
      const next = typeof body.new_password === "string" ? body.new_password : "";
      if (next.length < 8) {
        return Response.json(
          { error: "New password must be at least 8 characters" },
          { status: 400 }
        );
      }
      changePassword(next);
      // Rotation killed every session, including this one — re-issue.
      store.set(SESSION_COOKIE, await createSessionToken(), COOKIE_OPTS);
      return Response.json({ success: true });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
