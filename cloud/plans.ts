/**
 * PROPRIETARY — pare.money commercial layer. See ./LICENSE. Not AGPL.
 *
 * Plan definitions for the hosted service. Numbers are PLACEHOLDERS — the real
 * free-tier cap dimension + paid price points are PRD §6 / FR-72 [TBD].
 */

export type PlanId = "free" | "pro";

export interface Plan {
  id: PlanId;
  label: string;
  /** Hard cap on statements parsed per calendar month. null = unlimited. */
  statementsPerMonth: number | null;
  /** Stripe price id; null for the free plan. Set via env, never hardcode live ids. */
  stripePriceEnv: string | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", label: "Free", statementsPerMonth: 10, stripePriceEnv: null },
  pro: { id: "pro", label: "Pro", statementsPerMonth: null, stripePriceEnv: "STRIPE_PRICE_PRO" },
};

export const DEFAULT_PLAN: PlanId = "free";
