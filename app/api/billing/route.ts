import { NextRequest } from "next/server";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";

// GET /api/billing — the caller's plan/billing status for the /profile Plan card.
//
// Thin shim over cloud/billing/status.ts. Self-host returns { hosted: false }
// (the UI hides billing). Hosted but un-provisioned returns { configured: false }
// (also hidden). Otherwise returns the effective plan + whether the portal is
// available. Read-only; no Stripe API call.

export async function GET(request: NextRequest) {
  if (!isHostedMode()) {
    return Response.json({ hosted: false, configured: false });
  }

  const { createHostedAuth } = await import("@/lib/auth/hosted");
  const { getD1 } = await import("@/lib/auth/d1");
  const auth = createHostedAuth(await getD1());
  const resolved = await resolveUser(request, auth);
  if (!resolved) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { getBillingStatus } = await import("@/cloud/billing/status");
  const status = await getBillingStatus(resolved.userId);
  return Response.json({ hosted: true, ...status });
}
