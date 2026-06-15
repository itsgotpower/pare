/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Create a Stripe Billing Portal session. The portal is Stripe-hosted UI where
 * the customer can upgrade/downgrade, update their card, view invoices, and
 * cancel — so we build no billing management UI ourselves. Changes there fire
 * customer.subscription.* webhooks → ./webhook.ts keeps D1 in sync.
 */

import { getStripe, billingConfigured } from "./stripe";
import { getByUserId } from "./store";

/**
 * Returns the portal URL, or null when the user has no Stripe customer yet
 * (never checked out) — the route turns that into a 404.
 */
export async function createPortalSession(
  userId: string,
  returnUrl: string
): Promise<string | null> {
  if (!billingConfigured()) {
    throw new Error("Billing not configured (STRIPE_SECRET_KEY unset).");
  }

  const rec = await getByUserId(userId);
  if (!rec?.stripeCustomerId) return null;

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: rec.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}
