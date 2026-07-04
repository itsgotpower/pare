/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * The thin facade the upload route calls to enforce + record statement usage.
 * Ties together three already-gated pieces:
 *   - enforce.ts  — the limit decision (no-ops unless PARE_CLOUD=1)
 *   - store.ts    — the caller's effective plan
 *   - metering    — this month's usage counter
 *
 * Both functions no-op when the cloud layer is disabled, so the open-source core
 * (and any non-cloud hosted deploy) behaves exactly as before.
 */

import { checkStatementLimit, cloudEnabled, hasFeature, type LimitResult } from "./enforce";
import { resolvePlan } from "./store";
import { getStatementUsage, incrementStatementUsage } from "../metering/usage";
import type { Feature, PlanId } from "../plans";

/**
 * Allow/deny a new statement upload for the caller against their plan.
 *
 * On an allowed upload, `planId` is the caller's resolved plan — the route stamps
 * it onto the parse-job message so the queue consumer can enforce the per-plan
 * ACCOUNT cap post-parse (checkAccountLimit) without a D1 lookup, which isn't
 * available inside a queue() invocation. Absent when the cloud layer is off, so
 * self-host / non-cloud deploys never trigger the consumer-side gate.
 */
export async function enforceStatementUpload(
  userId: string
): Promise<LimitResult & { planId?: PlanId }> {
  if (!cloudEnabled()) return { allowed: true };
  const [planId, statementsThisMonth] = await Promise.all([
    resolvePlan(userId),
    getStatementUsage(userId),
  ]);
  return { ...checkStatementLimit({ planId, statementsThisMonth }), planId };
}

/** Record an accepted statement upload against this month's usage. */
export async function recordStatementUpload(userId: string): Promise<void> {
  if (!cloudEnabled()) return;
  await incrementStatementUsage(userId);
}

/**
 * Whether the caller's plan unlocks `feature`. Resolves the plan from the billing
 * store, then checks the entitlement. No-ops to ALLOW when the cloud layer is off
 * (self-host gets everything). Enforce this SERVER-SIDE in the feature's API route
 * (return 402 when false) — UI gating is cosmetic only.
 */
export async function requireFeature(userId: string, feature: Feature): Promise<boolean> {
  if (!cloudEnabled()) return true;
  return hasFeature(await resolvePlan(userId), feature);
}
