import { NextRequest } from "next/server";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import { unauthorized } from "@/lib/repo/scoped";

// ===========================================================================
// /api/ingest — the caller's per-user "forward your statements here" address.
//
//   GET  /api/ingest                       -> { address }   (created on first read)
//   POST /api/ingest  { action: "rotate" } -> { address }   (old address dies now)
//
// Email-in is a HOSTED + COMMERCIAL feature: the token logic lives in the
// proprietary cloud/ layer (cloud/ingest/token.ts), imported dynamically — exactly
// how the upload route loads cloud/billing — so an AGPL build that strips cloud/
// simply doesn't expose the endpoint (404). Self-host (single-user, local files)
// 404s too. The address maps to the AUTHENTICATED caller's id only.
// ===========================================================================

async function loadIngest() {
  try {
    return await import("@/cloud/ingest/token");
  } catch {
    return null; // cloud/ layer absent (AGPL build) -> feature off.
  }
}

async function hostedUser(request: NextRequest) {
  // Resolve the caller from the request-scoped better-auth (the D1 binding only
  // exists inside the Worker), exactly how the upload route wires it.
  const { createHostedAuth } = await import("@/lib/auth/hosted");
  const { getD1 } = await import("@/lib/auth/d1");
  const db = await getD1();
  const resolved = await resolveUser(request, createHostedAuth(db));
  return { resolved, db };
}

export async function GET(request: NextRequest) {
  if (!isHostedMode()) {
    return Response.json({ error: "Not available" }, { status: 404 });
  }
  const ingest = await loadIngest();
  if (!ingest) return Response.json({ error: "Not available" }, { status: 404 });

  const { resolved, db } = await hostedUser(request);
  if (!resolved) return unauthorized();
  const token = await ingest.getOrCreateIngestToken(resolved.userId, db);
  return Response.json({ address: ingest.formatIngestAddress(token) });
}

export async function POST(request: NextRequest) {
  if (!isHostedMode()) {
    return Response.json({ error: "Not available" }, { status: 404 });
  }
  const ingest = await loadIngest();
  if (!ingest) return Response.json({ error: "Not available" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "rotate") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const { resolved, db } = await hostedUser(request);
  if (!resolved) return unauthorized();
  const token = await ingest.rotateIngestToken(resolved.userId, db);
  return Response.json({ address: ingest.formatIngestAddress(token) });
}
