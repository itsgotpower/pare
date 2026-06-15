/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Read model for the billing UI: the caller's current plan + whether they have a
 * Stripe customer (and so can open the portal). Drives the Plan card on /profile
 * (GET /api/billing). Pure D1 read — no Stripe API call.
 */

import { billingConfigured } from "./stripe";
import { getByUserId, resolvePlan } from "./store";
import { PLANS, DEFAULT_PLAN } from "../plans";

export interface BillingStatus {
  /** STRIPE_SECRET_KEY provisioned — when false the UI hides billing entirely. */
  configured: boolean;
  /** The caller's effective plan (free unless an entitling subscription exists). */
  plan: {
    id: string;
    label: string;
    /** null = unlimited. */
    statementsPerMonth: number | null;
  };
  /** Raw Stripe subscription status (active/trialing/past_due/…), or null. */
  status: string | null;
  /** Has a Stripe customer → the Billing Portal ("Manage billing") is available. */
  manageable: boolean;
}

function planView(id: keyof typeof PLANS) {
  const p = PLANS[id];
  return { id: p.id, label: p.label, statementsPerMonth: p.statementsPerMonth };
}

export async function getBillingStatus(userId: string): Promise<BillingStatus> {
  if (!billingConfigured()) {
    return { configured: false, plan: planView(DEFAULT_PLAN), status: null, manageable: false };
  }
  const rec = await getByUserId(userId);
  const planId = await resolvePlan(userId);
  return {
    configured: true,
    plan: planView(planId),
    status: rec?.status ?? null,
    manageable: Boolean(rec?.stripeCustomerId),
  };
}
