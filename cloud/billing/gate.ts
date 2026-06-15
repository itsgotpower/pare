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

import { checkStatementLimit, cloudEnabled, type LimitResult } from "./enforce";
import { resolvePlan } from "./store";
import { getStatementUsage, incrementStatementUsage } from "../metering/usage";

/** Allow/deny a new statement upload for the caller against their plan. */
export async function enforceStatementUpload(userId: string): Promise<LimitResult> {
  if (!cloudEnabled()) return { allowed: true };
  const [planId, statementsThisMonth] = await Promise.all([
    resolvePlan(userId),
    getStatementUsage(userId),
  ]);
  return checkStatementLimit({ planId, statementsThisMonth });
}

/** Record an accepted statement upload against this month's usage. */
export async function recordStatementUpload(userId: string): Promise<void> {
  if (!cloudEnabled()) return;
  await incrementStatementUsage(userId);
}
