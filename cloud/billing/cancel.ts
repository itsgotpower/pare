/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Cancel a user's live Stripe subscription. Called (best-effort) from the
 * account-deletion route so deleting an account also stops billing. Stripe will
 * fire customer.subscription.deleted → ./webhook.ts, but deletion also wipes the
 * D1 row directly, so this is purely "stop charging the card".
 *
 * No-ops silently when billing isn't configured or the user has no subscription.
 */

import { billingConfigured, getStripe } from "./stripe";
import { getByUserId } from "./store";

export async function cancelSubscriptionForUser(userId: string): Promise<void> {
  if (!billingConfigured()) return;
  const rec = await getByUserId(userId);
  if (!rec?.stripeSubscriptionId) return;
  const stripe = getStripe();
  await stripe.subscriptions.cancel(rec.stripeSubscriptionId);
}
