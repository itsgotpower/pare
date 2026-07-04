/**
 * PROPRIETARY — pare.money commercial layer. See ./LICENSE. Not AGPL.
 *
 * Plan definitions for the hosted service. Caps/labels decided 2026-07-04
 * (PRD §6): Free = 5 statements/month + 1 account; Plus ($8/mo or $72/yr USD)
 * = unlimited statements + 2 accounts. Statement cap enforced at upload time
 * (billing/gate.ts); account cap enforced post-parse in the queue consumer via
 * checkAccountLimit (billing/enforce.ts — the source is only known after
 * parsing). These must match the public /pricing page (components/marketing/
 * pricing-tiers.tsx) — update both together. Price points live in Stripe
 * (STRIPE_PRICE_PRO), never here.
 */

export type PlanId = "free" | "pro";

/**
 * Boolean capability unlocked by a plan. Add a premium feature by (1) adding it to
 * this union and (2) listing it in the unlocking plan's `features` below; then gate
 * it server-side via cloud/billing/gate.ts `requireFeature`.
 */
export type Feature = "email_ingest" | "llm_autocoverage";

export interface Plan {
  id: PlanId;
  label: string;
  /** Hard cap on statements parsed per calendar month. null = unlimited. */
  statementsPerMonth: number | null;
  /** Hard cap on distinct bank/card accounts (statement `source` values;
   *  manual cash rows never count). null = unlimited. */
  accounts: number | null;
  /** Boolean entitlements this plan unlocks. */
  features: ReadonlySet<Feature>;
  /** Stripe price id; null for the free plan. Set via env, never hardcode live ids. */
  stripePriceEnv: string | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", label: "Free", statementsPerMonth: 5, accounts: 1,
    features: new Set<Feature>(),
    stripePriceEnv: null,
  },
  // Public name is "Plus"; the id stays "pro" (persisted in billing rows and
  // matched by the Stripe webhook — renaming the id is a data migration).
  pro: {
    id: "pro", label: "Plus", statementsPerMonth: null, accounts: 2,
    // PLACEHOLDER membership pending the FR-72 plan matrix. Both are cloud-only
    // conveniences, so gating them removes nothing from existing free users.
    features: new Set<Feature>(["email_ingest", "llm_autocoverage"]),
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
};

export const DEFAULT_PLAN: PlanId = "free";
