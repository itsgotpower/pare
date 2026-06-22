import { NextRequest } from "next/server";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";

// POST /api/billing/portal — open the Stripe Billing Portal (manage/cancel).
//
// Thin shim over cloud/billing/portal.ts. Resolves the caller, creates a portal
// session for their Stripe customer, and returns { url }. 404 when the user has
// no customer yet (never checked out). Hosted-only; 503 until Stripe is wired.

export async function POST(request: NextRequest) {
  if (!isHostedMode()) {
    return Response.json({ error: "Billing is a hosted-mode feature." }, { status: 400 });
  }
  if (!(await allowRequest("RL_AUTH", clientIp(request)))) return tooManyRequests();

  const { createHostedAuth } = await import("@/lib/auth/hosted");
  const { getD1 } = await import("@/lib/auth/d1");
  const auth = createHostedAuth(await getD1());
  const resolved = await resolveUser(request, auth);
  if (!resolved) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const origin = new URL(request.url).origin;
  try {
    const { createPortalSession } = await import("@/cloud/billing/portal");
    const url = await createPortalSession(resolved.userId, `${origin}/profile`);
    if (!url) {
      return Response.json({ error: "No subscription found." }, { status: 404 });
    }
    return Response.json({ url });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Portal failed";
    return Response.json({ error: m }, { status: 503 });
  }
}
