/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Stripe webhook handler. Stripe authenticates this endpoint with a SIGNATURE
 * (not a user session), so the route shim does NOT gate on auth — the signature
 * check below IS the authentication. The shim (app/api/billing/webhook) just
 * forwards the request here.
 *
 * WORKERS GOTCHA: verify with the ASYNC api. `constructEvent` (sync) uses Node's
 * synchronous crypto and throws on the edge runtime; `constructEventAsync` with
 * `Stripe.createSubtleCryptoProvider()` uses WebCrypto and works on Workers.
 * Also: the signature is computed over the RAW request body, so read
 * `request.text()` and pass it verbatim — never re-serialize a parsed object.
 *
 * IDEMPOTENT: Stripe redelivers events (and may deliver out of order). Each
 * handler upserts the LATEST state keyed by userId (store.upsert), so a replay is
 * harmless. On any handler error we return 500 so Stripe retries.
 */

import Stripe from "stripe";
import { getStripe, billingConfigured } from "./stripe";
import { getByCustomerId, upsert, type SubscriptionRecord } from "./store";
import { PLANS, DEFAULT_PLAN, type PlanId } from "../plans";

// One provider per isolate (stateless).
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (!billingConfigured()) {
    return Response.json({ error: "Billing not configured." }, { status: 503 });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "Webhook secret not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const body = await request.text(); // RAW body — required for signature verification
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    const m = err instanceof Error ? err.message : "bad signature";
    return Response.json({ error: `Signature verification failed: ${m}` }, { status: 400 });
  }

  try {
    await processEvent(stripe, event);
  } catch (err) {
    // 500 → Stripe retries with backoff. The handler is idempotent, so a retry
    // after a partial write converges.
    const m = err instanceof Error ? err.message : "handler error";
    return Response.json({ error: m }, { status: 500 });
  }

  return Response.json({ received: true });
}

// ---------------------------------------------------------------------------

async function processEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.client_reference_id;
      const subId = idOf(s.subscription);
      if (!userId || !subId) return; // not a subscription checkout we track
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(userId, sub, false);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = await userIdForSubscription(sub);
      if (!userId) return; // unknown customer — nothing to sync
      await syncSubscription(userId, sub, event.type === "customer.subscription.deleted");
      return;
    }

    // Everything else (invoice.*, payment_intent.*, …) is ignored for now. Add
    // cases here as the billing surface grows (e.g. invoice.payment_failed →
    // dunning email).
    default:
      return;
  }
}

/** Resolve the Pare userId for a subscription: prefer its metadata, else the customer map. */
async function userIdForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.userId;
  if (fromMeta) return fromMeta;
  const customerId = idOf(sub.customer);
  if (!customerId) return null;
  const rec = await getByCustomerId(customerId);
  return rec?.userId ?? null;
}

async function syncSubscription(
  userId: string,
  sub: Stripe.Subscription,
  deleted: boolean
): Promise<void> {
  const rec: SubscriptionRecord = {
    userId,
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    plan: deleted ? DEFAULT_PLAN : planForSubscription(sub),
    status: deleted ? "canceled" : sub.status,
    currentPeriodEnd: subPeriodEnd(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
  await upsert(rec);
}

/** Map the subscription's price to a PlanId (Pro if it matches STRIPE_PRICE_PRO). */
function planForSubscription(sub: Stripe.Subscription): PlanId {
  const proPriceEnv = PLANS.pro.stripePriceEnv;
  const proPrice = proPriceEnv ? process.env[proPriceEnv] : undefined;
  const priceId = sub.items?.data?.[0]?.price?.id;
  return proPrice && priceId === proPrice ? "pro" : DEFAULT_PLAN;
}

// current_period_end moved from the Subscription to the subscription ITEM in
// recent Stripe API versions; read the item first, fall back to the legacy
// top-level field so this works across versions.
function subPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return item?.current_period_end ?? legacy ?? null;
}

/** Coerce a Stripe expandable field (string id | object | null) to its id. */
function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}
