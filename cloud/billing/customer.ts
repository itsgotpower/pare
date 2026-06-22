/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Map a Pare user to a Stripe Customer, creating one on first checkout and
 * caching its id in the D1 subscription row so later checkouts and the billing
 * portal reuse it.
 */

import { getStripe } from "./stripe";
import { getByUserId, setCustomerId } from "./store";
import { getD1 } from "@/lib/auth/d1";

export async function getOrCreateCustomer(userId: string): Promise<string> {
  const existing = await getByUserId(userId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  // Email/name come from the better-auth `user` row so the Stripe customer is
  // recognisable in the dashboard and receipts go to the right address.
  const db = await getD1();
  const user = (await db
    .prepare('SELECT "email","name" FROM "user" WHERE "id" = ?')
    .bind(userId)
    .first()) as { email?: string; name?: string } | null;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user?.email,
    name: user?.name,
    // metadata.userId lets the webhook map a customer back to a Pare user even
    // before the subscription row exists.
    metadata: { userId },
  });

  await setCustomerId(userId, customer.id);
  return customer.id;
}
