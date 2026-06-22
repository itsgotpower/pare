/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Plan-limit enforcement. The whole module is GATED: when PARE_CLOUD is unset
 * (i.e. someone running the open-source core), `cloudEnabled()` is false and the
 * enforcement helpers no-op / allow everything, so no proprietary path runs.
 */

import { PLANS, DEFAULT_PLAN, type PlanId, type Feature } from "../plans";

export function cloudEnabled(): boolean {
  return process.env.PARE_CLOUD === "1";
}

export interface UsageQuery {
  /** Caller's plan; resolve from the billing store (Stripe/D1) upstream of this. */
  planId: PlanId;
  /** Statements the user has already parsed this calendar month. */
  statementsThisMonth: number;
}

export interface LimitResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a new statement upload is within the caller's plan.
 * No-op (always allowed) when the cloud layer is disabled.
 */
export function checkStatementLimit(q: UsageQuery): LimitResult {
  if (!cloudEnabled()) return { allowed: true };

  const plan = PLANS[q.planId] ?? PLANS[DEFAULT_PLAN];
  if (plan.statementsPerMonth === null) return { allowed: true };

  if (q.statementsThisMonth >= plan.statementsPerMonth) {
    return {
      allowed: false,
      reason: `${plan.label} plan allows ${plan.statementsPerMonth} statements/month. Upgrade for more.`,
    };
  }
  return { allowed: true };
}

/**
 * Whether a plan unlocks a given feature. Like the limit checks, this no-ops to
 * ALLOW when the cloud layer is disabled, so the open-source core / self-host keeps
 * every feature.
 */
export function hasFeature(planId: PlanId, feature: Feature): boolean {
  if (!cloudEnabled()) return true;
  return (PLANS[planId] ?? PLANS[DEFAULT_PLAN]).features.has(feature);
}
