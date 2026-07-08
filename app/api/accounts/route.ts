import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// Account management (nickname / hide / mark closed) — see lib/db/accounts.ts
// for the semantics. Note /api/account (singular) is the hosted account-DELETION
// route; this one manages data sources.

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  return Response.json({ accounts: await repo.accounts.list() });
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  let body: {
    source?: string;
    nickname?: string | null;
    hidden?: boolean;
    closed?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.source || typeof body.source !== "string") {
    return Response.json({ error: "source required" }, { status: 400 });
  }
  if (body.nickname !== undefined && body.nickname !== null && typeof body.nickname !== "string") {
    return Response.json({ error: "nickname must be a string" }, { status: 400 });
  }
  if (typeof body.nickname === "string" && body.nickname.length > 40) {
    return Response.json({ error: "nickname too long (max 40)" }, { status: 400 });
  }
  if (body.hidden !== undefined && typeof body.hidden !== "boolean") {
    return Response.json({ error: "hidden must be a boolean" }, { status: 400 });
  }
  if (body.closed !== undefined && typeof body.closed !== "boolean") {
    return Response.json({ error: "closed must be a boolean" }, { status: 400 });
  }

  const ok = await repo.accounts.setMeta(body.source, {
    nickname: body.nickname,
    hidden: body.hidden,
    closed: body.closed,
  });
  if (!ok) {
    return Response.json({ error: "Unknown account" }, { status: 404 });
  }
  return Response.json({ ok: true, accounts: await repo.accounts.list() });
}
