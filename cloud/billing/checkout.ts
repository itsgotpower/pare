/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Create a Stripe Checkout Session for the Pro subscription. The client redirects
 * the browser to the returned URL; Stripe hosts the payment page. On completion
 * Stripe fires `checkout.session.completed` → ./webhook.ts records the plan.
 */

import { getStripe, billingConfigured } from "./stripe";
import { getOrCreateCustomer } from "./customer";
import { PLANS } from "../plans";

export interface CheckoutUrls {
  /** Where Stripe returns the user after a successful payment. */
  successUrl: string;
  /** Where Stripe returns the user if they cancel. */
  cancelUrl: string;
}

export async function createCheckoutSession(
  userId: string,
  urls: CheckoutUrls
): Promise<string> {
  if (!billingConfigured()) {
    throw new Error("Billing not configured (STRIPE_SECRET_KEY unset).");
  }

  const priceEnv = PLANS.pro.stripePriceEnv;
  const price = priceEnv ? process.env[priceEnv] : undefined;
  if (!price) {
    throw new Error(`Stripe price not configured (${priceEnv ?? "STRIPE_PRICE_PRO"} unset).`);
  }

  const stripe = getStripe();
  const customer = await getOrCreateCustomer(userId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    // client_reference_id is echoed back on checkout.session.completed;
    // subscription_data.metadata stamps the userId onto the Subscription so the
    // later customer.subscription.* events carry it too.
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return session.url;
}
