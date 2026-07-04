/**
 * PROPRIETARY — pare.money commercial layer. See ./LICENSE. Not AGPL.
 *
 * Plan definitions for the hosted service. Numbers are PLACEHOLDERS — the real
 * free-tier cap dimension + paid price points are PRD §6 / FR-72 [TBD].
 */

export type PlanId = "free" | "pro";

/**
 * Boolean capability unlocked by a plan. Add a premium feature by (1) adding it to
 * this union and (2) listing it in the unlocking plan's `features` below; then gate
 * it server-side via cloud/billing/gate.ts `requireFeature`.
 */
export type Feature = "email_ingest" | "llm_autocoverage" | "mcp_connector";

export interface Plan {
  id: PlanId;
  label: string;
  /** Hard cap on statements parsed per calendar month. null = unlimited. */
  statementsPerMonth: number | null;
  /** Boolean entitlements this plan unlocks. */
  features: ReadonlySet<Feature>;
  /** Stripe price id; null for the free plan. Set via env, never hardcode live ids. */
  stripePriceEnv: string | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", label: "Free", statementsPerMonth: 10,
    // mcp_connector is deliberately on EVERY plan for Stage A (it's the invite
    // differentiator); the /api/mcp gate exists so moving it to a paid tier
    // later is a one-line change here. FR-72 pricing pass decides.
    features: new Set<Feature>(["mcp_connector"]),
    stripePriceEnv: null,
  },
  pro: {
    id: "pro", label: "Pro", statementsPerMonth: null,
    // PLACEHOLDER membership pending the FR-72 plan matrix. email_ingest +
    // llm_autocoverage are cloud-only conveniences, so gating them removes
    // nothing from existing free users.
    features: new Set<Feature>(["email_ingest", "llm_autocoverage", "mcp_connector"]),
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
};

export const DEFAULT_PLAN: PlanId = "free";
