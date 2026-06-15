/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * The Stripe SDK client, configured for the Cloudflare Workers runtime.
 *
 * TWO Workers-specific requirements baked in here:
 *   1. `Stripe.createFetchHttpClient()` — the SDK defaults to Node's `http`
 *      module, which doesn't exist on Workers. The fetch client uses the
 *      platform `fetch` instead.
 *   2. Webhook signature verification must use the ASYNC api
 *      (`constructEventAsync` + `Stripe.createSubtleCryptoProvider()`); the sync
 *      `constructEvent` uses Node's synchronous crypto and throws on the edge.
 *      See ./webhook.ts.
 *
 * INERT until provisioned: `billingConfigured()` is false when STRIPE_SECRET_KEY
 * is unset, and `getStripe()` throws rather than returning a half-built client.
 * The route shims check `billingConfigured()` and return a clean 503, matching
 * the Turnstile/Sentry "gated on its secret" pattern elsewhere.
 *
 * Secrets (set with `wrangler secret put`, never committed):
 *   STRIPE_SECRET_KEY      — the API secret (sk_live_… / sk_test_…)
 *   STRIPE_WEBHOOK_SECRET  — the endpoint signing secret (whsec_…); see webhook.ts
 *   STRIPE_PRICE_PRO       — the Pro price id (price_…); a [vars] entry, not secret
 */

import Stripe from "stripe";

/** True once the Stripe secret is provisioned. Routes 503 when false. */
export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let cached: Stripe | null = null;

/**
 * The configured Stripe client. Throws if STRIPE_SECRET_KEY is unset — callers
 * gate on `billingConfigured()` first. Cached per isolate (the client is just
 * configuration; the key never changes within an isolate).
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set; billing is not configured.");
  }
  if (cached) return cached;
  cached = new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    // apiVersion omitted — the SDK pins its own default, so we don't carry a
    // brittle version literal here. Pin it explicitly if you need a specific one.
  });
  return cached;
}
