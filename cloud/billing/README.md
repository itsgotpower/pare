# cloud/billing — Stripe subscriptions (proprietary)

**PROPRIETARY** — see [../LICENSE](../LICENSE). Not AGPL. Hosted-only; every entry
point is inert until provisioned.

Implements **FR-72 / roadmap Phase 6** (billing). Free + Pro plans defined in
[../plans.ts](../plans.ts); per-month statement cap enforced in
[./enforce.ts](./enforce.ts).

## Flow

```
/api/billing/checkout ─► checkout.ts ─► Stripe Checkout (hosted) ─┐
/api/billing/portal   ─► portal.ts   ─► Stripe Billing Portal     │
                                                                  ▼
                                          Stripe events ─► /api/billing/webhook
                                                              └► webhook.ts ─► D1 `subscription`
upload ─► gate.ts ─► enforce.ts (plan) + metering (usage) ─► allow / 402
```

| File | Role |
|---|---|
| `stripe.ts` | SDK client, configured for Workers (fetch http client + SubtleCrypto). |
| `store.ts` | D1 read/write of the `subscription` row; `resolvePlan(userId)`. |
| `customer.ts` | `getOrCreateCustomer(userId)` — maps a user ↔ Stripe customer. |
| `checkout.ts` | Create a Checkout Session (Pro subscription). |
| `portal.ts` | Create a Billing Portal session (manage / cancel). |
| `webhook.ts` | Verify (async) + handle Stripe events → upsert D1. |
| `cancel.ts` | Cancel a user's subscription (called on account deletion). |
| `gate.ts` | `enforceStatementUpload` / `recordStatementUpload` — the upload facade. |
| `enforce.ts` | Plan-limit decision (no-op unless `PARE_CLOUD=1`). |

Usage metering: [../metering/usage.ts](../metering/usage.ts) over D1 `billing_usage`.

## Gates

- **`PARE_CLOUD=1`** turns ON enforcement (limits + metering). Unset ⇒ everything
  is allowed (open-source core behaviour).
- **`STRIPE_SECRET_KEY` present** turns ON the Stripe calls (checkout/portal/
  webhook/cancel). Unset ⇒ routes return 503; nothing Stripe runs.

## Config

| Var | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | `wrangler secret` | API secret (`sk_…`). |
| `STRIPE_WEBHOOK_SECRET` | `wrangler secret` | Endpoint signing secret (`whsec_…`). |
| `STRIPE_PRICE_PRO` | `[vars]` | Pro price id (`price_…`). |
| `PARE_CLOUD` | `[vars]` | `1` to enforce plan limits. |

## Migrations (D1 auth DB `pare-auth`)

`wrangler d1 migrations apply pare-auth` — applies
`d1/migrations/0003_subscription.sql` and `0004_billing_usage.sql`.

## Webhook

Point a Stripe webhook endpoint at `https://<host>/api/billing/webhook` for:
`checkout.session.completed`, `customer.subscription.created|updated|deleted`.
Local dev: `stripe listen --forward-to localhost:3000/api/billing/webhook`
(prints the `whsec_…` to use as `STRIPE_WEBHOOK_SECRET`), then `stripe trigger
checkout.session.completed`.

## Not done here (next)

- UI: an upgrade button (POST `/api/billing/checkout` → redirect to `url`) and a
  "Manage billing" link (POST `/api/billing/portal`) on `/profile`.
- The free cap (10/mo) and Pro price are PLACEHOLDERS pending PRD §6 / FR-72.
- iOS (Expo): App Store rules generally require Apple IAP for in-app digital
  subscriptions — Stripe Checkout covers web/Android, not necessarily iOS.
