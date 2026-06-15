-- Hosted-mode billing: the per-user subscription / entitlement record for the
-- paid Pare service (Stripe). One row per user (1:1), keyed by the better-auth
-- user id.
--
-- Like 0001/0002 this lives in the D1 AUTH database ONLY (binding `DB`, database
-- `pare-auth`), applied via `wrangler d1 migrations apply pare-auth`. Billing
-- state belongs with identity in the control-plane D1, NOT in the user's Durable
-- Object (which holds only encrypted financial data): the Stripe webhook
-- authenticates by signature, has no user session, and needs a cheap indexed
-- customer→user lookup — that's a D1 query, not a DO round-trip.
--
-- Self-hosted mode never applies this file (no better-auth, no Stripe).
--
-- NOTE: unrelated to lib/repo's SubscriptionRepo, which detects a user's
-- recurring *charges* inside their own data. This table is BILLING.
--
-- Written/read by cloud/billing/store.ts. `plan` holds a PlanId from
-- cloud/plans.ts ('free' | 'pro'). Stripe ids are nullable until first checkout.

CREATE TABLE IF NOT EXISTS "subscription" (
  "userId"               TEXT NOT NULL PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "stripeCustomerId"     TEXT UNIQUE,
  "stripeSubscriptionId" TEXT UNIQUE,
  "plan"                 TEXT NOT NULL DEFAULT 'free',
  "status"               TEXT,
  "currentPeriodEnd"     INTEGER,
  "cancelAtPeriodEnd"    INTEGER NOT NULL DEFAULT 0,
  "updatedAt"            DATE
);

-- The webhook maps a Stripe customer back to a user via this index.
CREATE INDEX IF NOT EXISTS "subscription_customer_idx" ON "subscription"("stripeCustomerId");
