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

export interface AccountUsageQuery {
  /**
   * Caller's plan id. Typed as string (not PlanId) because the value has crossed
   * a queue-message boundary — an unknown/stale id falls back to the free caps.
   */
  planId: string;
  /** Distinct `source` values the user already has rows for (repo.transactions.sources()). */
  existingSources: readonly string[];
  /** The `source` the statement being ingested would add rows under. */
  newSource: string;
}

// Manual cash quick-adds (source 'manual') are not a bank account and never
// count against the account cap.
const NON_ACCOUNT_SOURCES = new Set(["manual"]);

/**
 * Decide whether ingesting a statement for `newSource` is within the caller's
 * per-plan ACCOUNT cap. Re-uploads for an already-known source are always
 * allowed — the cap only blocks introducing a NEW distinct account.
 *
 * Deliberately PURE — no cloudEnabled() check, unlike checkStatementLimit. The
 * queue consumer is this check's caller, and inside a Cloudflare queue()
 * invocation process.env is not reliably readable, so an env probe here could
 * silently disable the cap in production. The "cloud off ⇒ allow everything"
 * property is enforced upstream instead: the producer only stamps a planId onto
 * the parse-job message when the cloud layer is enabled at upload time, and the
 * consumer skips this check entirely when the message carries no planId
 * (self-host never enqueues at all).
 */
export function checkAccountLimit(q: AccountUsageQuery): LimitResult {
  const plan = PLANS[q.planId as PlanId] ?? PLANS[DEFAULT_PLAN];
  if (plan.accounts === null) return { allowed: true };

  const existing = new Set(
    q.existingSources.filter((s) => s && !NON_ACCOUNT_SOURCES.has(s))
  );
  if (existing.has(q.newSource)) return { allowed: true };

  if (existing.size >= plan.accounts) {
    return {
      allowed: false,
      reason: `${plan.label} plan includes ${plan.accounts} account${
        plan.accounts === 1 ? "" : "s"
      }. Upgrade for more.`,
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
