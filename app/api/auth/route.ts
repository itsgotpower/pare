import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getRepo } from "@/lib/repo";
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
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  const configured = isConfigured();
  const authenticated = configured && (await isAuthenticated());

  if (!authenticated) {
    return Response.json({ configured, authenticated: false });
  }

  const user = getUser()!;
  return Response.json({
    configured: true,
    authenticated: true,
    profile: { ...user, health: await getRepo().profile.dataHealth() },
  });
}

export async function POST(request: NextRequest) {
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
      store.set(SESSION_COOKIE, createSessionToken(), COOKIE_OPTS);
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
      store.set(SESSION_COOKIE, createSessionToken(), COOKIE_OPTS);
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
      store.set(SESSION_COOKIE, createSessionToken(), COOKIE_OPTS);
      return Response.json({ success: true });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}
