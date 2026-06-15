import { NextRequest } from "next/server";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";

// POST /api/billing/checkout — start a Stripe Checkout for the Pro plan.
//
// Thin shim over the proprietary cloud layer (cloud/billing/checkout.ts), the
// sanctioned pattern for hosted-only routes (cloud/README.md rule 3). Resolves
// the caller (cookie OR bearer, so the Expo app can call it too), creates a
// Checkout Session, and returns { url } for the client to redirect to.
//
// Hosted-only. Returns 503 if Stripe isn't provisioned (STRIPE_SECRET_KEY /
// STRIPE_PRICE_PRO unset) — inert until configured.

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
    const { createCheckoutSession } = await import("@/cloud/billing/checkout");
    const url = await createCheckoutSession(resolved.userId, {
      successUrl: `${origin}/profile?checkout=success`,
      cancelUrl: `${origin}/profile?checkout=cancel`,
    });
    return Response.json({ url });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Checkout failed";
    return Response.json({ error: m }, { status: 503 });
  }
}
