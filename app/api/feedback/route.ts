import { NextRequest } from "next/server";
import { getScopedRepo, getSharedRepo, unauthorized } from "@/lib/repo/scoped";
import { isHostedMode } from "@/lib/auth/resolve";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";
import { FEEDBACK_MESSAGE_MAX } from "@/lib/db/feedback";
import { safeEqual } from "@/lib/safe-equal";
import { csvField } from "@/lib/csv";

// In-app product feedback (the FEEDBACK dialog). NOT in the middleware's
// PUBLIC_PATHS: self-host stays behind the single-user gate, and on hosted
// (where /api/* passes the middleware) POST authenticates in-route via
// getScopedRepo. Submissions land in the SHARED repo — same tenant-less store
// as the waitlist — so the admin export reads one place, not N user DOs.
export async function POST(request: NextRequest) {
  // Backstop rate limit (no-op when the binding is absent — dev/self-host).
  const ip = clientIp(request);
  if (!(await allowRequest("RL_FEEDBACK", ip))) return tooManyRequests();

  // Auth check only — the write goes to the shared repo below. Hosted: null
  // without a valid cookie/bearer -> 401. Self-host: the middleware already
  // gated this path.
  const caller = await getScopedRepo(request);
  if (!caller) return unauthorized();

  let kind = "";
  let message = "";
  let email: string | undefined;
  try {
    const body = await request.json();
    kind = typeof body?.kind === "string" ? body.kind : "";
    message = typeof body?.message === "string" ? body.message : "";
    email = typeof body?.email === "string" ? body.email : undefined;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  // Bound the payload before it crosses the RPC to the shared DO; submitFeedback
  // re-checks as defense-in-depth.
  if (message.length > FEEDBACK_MESSAGE_MAX + 100 || (email?.length ?? 0) > 254) {
    return Response.json({ error: "Message too long." }, { status: 400 });
  }

  const repo = await getSharedRepo();
  const result = await repo.feedback.submit(kind, message, email);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ success: true });
}

// Two read surfaces on one verb:
//
// 1. No token supplied -> deploy-mode probe for the FEEDBACK dialog, which
//    renders the in-app form on hosted and a GitHub-issues link on self-host.
//    Detected at runtime like /login's mode probe — no NEXT_PUBLIC flag.
//
// 2. Token supplied -> admin export of captured feedback (CSV, or ?format=json),
//    mirroring the waitlist export: gated on FEEDBACK_ADMIN_TOKEN, and when that
//    secret is UNSET the export arm is disabled (404) so it doesn't exist on an
//    unconfigured deploy. Set it once with:
//    npx wrangler secret put FEEDBACK_ADMIN_TOKEN
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("token") ??
    "";

  if (!provided) {
    return Response.json({ hosted: isHostedMode() });
  }

  const expected = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!expected) return new Response("Not found", { status: 404 });
  if (!safeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const repo = await getSharedRepo();
  const entries = await repo.feedback.list();

  if (url.searchParams.get("format") === "json") {
    return Response.json({ count: entries.length, entries });
  }

  const rows = entries.map((e) =>
    [String(e.id), e.kind, e.message, e.email ?? "", e.created_at].map(csvField).join(",")
  );
  const csv = ["id,kind,message,email,created_at", ...rows].join("\n") + "\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="feedback.csv"',
    },
  });
}
