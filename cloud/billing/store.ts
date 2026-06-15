/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Billing-state store over the D1 auth database (binding `DB`). One row per user
 * in the `subscription` table (d1/migrations/0003_subscription.sql). Pure D1 —
 * no Stripe SDK here, so it stays cheap to call from the enforcement hot path.
 *
 * NOTE: distinct from lib/repo's SubscriptionRepo (which detects a user's
 * recurring *charges*). This is the user's PLAN / billing entitlement.
 */

import { getD1 } from "@/lib/auth/d1";
import { DEFAULT_PLAN, type PlanId } from "../plans";

export interface SubscriptionRecord {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanId;
  status: string | null;
  /** Unix seconds — the current billing period end (renewal / expiry). */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

// Stripe statuses that still grant paid entitlement. `past_due` is kept as a
// short grace window (a card retry is in flight); drop it for a hard cut-off.
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRecord(row: any): SubscriptionRecord {
  return {
    userId: String(row.userId),
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    plan: (row.plan ?? DEFAULT_PLAN) as PlanId,
    status: row.status ?? null,
    currentPeriodEnd: row.currentPeriodEnd != null ? Number(row.currentPeriodEnd) : null,
    cancelAtPeriodEnd: Number(row.cancelAtPeriodEnd ?? 0) === 1,
  };
}

export async function getByUserId(userId: string): Promise<SubscriptionRecord | null> {
  const db = await getD1();
  const row = await db
    .prepare('SELECT * FROM "subscription" WHERE "userId" = ?')
    .bind(userId)
    .first();
  return row ? toRecord(row) : null;
}

export async function getByCustomerId(customerId: string): Promise<SubscriptionRecord | null> {
  const db = await getD1();
  const row = await db
    .prepare('SELECT * FROM "subscription" WHERE "stripeCustomerId" = ?')
    .bind(customerId)
    .first();
  return row ? toRecord(row) : null;
}

/** Persist the Stripe customer id for a user (created on first checkout). */
export async function setCustomerId(userId: string, customerId: string): Promise<void> {
  const db = await getD1();
  await db
    .prepare(
      'INSERT INTO "subscription" ("userId","stripeCustomerId","plan","updatedAt") VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT("userId") DO UPDATE SET ' +
        '"stripeCustomerId" = excluded."stripeCustomerId", "updatedAt" = excluded."updatedAt"'
    )
    .bind(userId, customerId, DEFAULT_PLAN, new Date().toISOString())
    .run();
}

/**
 * Upsert the full subscription state from a Stripe event. Idempotent — Stripe
 * redelivers events, so this overwrites with the latest known state keyed by
 * userId rather than appending.
 */
export async function upsert(rec: SubscriptionRecord): Promise<void> {
  const db = await getD1();
  await db
    .prepare(
      'INSERT INTO "subscription" ' +
        '("userId","stripeCustomerId","stripeSubscriptionId","plan","status","currentPeriodEnd","cancelAtPeriodEnd","updatedAt") ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        'ON CONFLICT("userId") DO UPDATE SET ' +
        '"stripeCustomerId" = excluded."stripeCustomerId", ' +
        '"stripeSubscriptionId" = excluded."stripeSubscriptionId", ' +
        '"plan" = excluded."plan", ' +
        '"status" = excluded."status", ' +
        '"currentPeriodEnd" = excluded."currentPeriodEnd", ' +
        '"cancelAtPeriodEnd" = excluded."cancelAtPeriodEnd", ' +
        '"updatedAt" = excluded."updatedAt"'
    )
    .bind(
      rec.userId,
      rec.stripeCustomerId,
      rec.stripeSubscriptionId,
      rec.plan,
      rec.status,
      rec.currentPeriodEnd,
      rec.cancelAtPeriodEnd ? 1 : 0,
      new Date().toISOString()
    )
    .run();
}

/**
 * The caller's EFFECTIVE plan. Free unless a stored record names a paid plan AND
 * its Stripe status still grants entitlement. This is what cloud/billing/
 * enforce.ts consumes (UsageQuery.planId).
 */
export async function resolvePlan(userId: string): Promise<PlanId> {
  const rec = await getByUserId(userId);
  if (!rec) return DEFAULT_PLAN;
  if (rec.plan !== "free" && rec.status && ENTITLING_STATUSES.has(rec.status)) {
    return rec.plan;
  }
  return DEFAULT_PLAN;
}
