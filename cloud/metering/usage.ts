/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Usage metering for plan-limit enforcement. Backed by the D1 `billing_usage`
 * table (d1/migrations/0004_billing_usage.sql): one counter per (user, calendar
 * month). Reading/incrementing here is a single indexed D1 op, so the upload
 * route can enforce a limit without touching the user's Durable Object.
 *
 * See cloud/billing/gate.ts for the enforce + record facade the route calls.
 */

import { getD1 } from "@/lib/auth/d1";

/** Current billing period as 'YYYY-MM' (UTC), the `billing_usage.period` key. */
export function currentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Statements the user has uploaded in the given period (default: this month). */
export async function getStatementUsage(
  userId: string,
  period: string = currentPeriod()
): Promise<number> {
  const db = await getD1();
  const row = (await db
    .prepare('SELECT "statements" FROM "billing_usage" WHERE "userId" = ? AND "period" = ?')
    .bind(userId, period)
    .first()) as { statements?: number } | null;
  return Number(row?.statements ?? 0);
}

/** Increment the user's statement count for the given period (atomic upsert). */
export async function incrementStatementUsage(
  userId: string,
  period: string = currentPeriod()
): Promise<void> {
  const db = await getD1();
  await db
    .prepare(
      'INSERT INTO "billing_usage" ("userId","period","statements") VALUES (?, ?, 1) ' +
        'ON CONFLICT("userId","period") DO UPDATE SET "statements" = "statements" + 1'
    )
    .bind(userId, period)
    .run();
}
