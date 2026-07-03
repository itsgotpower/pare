import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";
import { merchantDisplay, merchantSlug } from "../merchant-key";
import { median, frequencyLabel } from "./stats";

export interface PriceChange {
  from: number; // stable price before the change (median)
  to: number; // new stable price (median of the last two charges)
  pct: number; // signed percent, rounded
}

export interface Subscription {
  merchant: string;
  slug: string; // links to the merchant drill-down (/merchants/<slug>)
  category: string;
  charges: number;
  months: number;
  typical: number; // median single charge
  monthlyCost: number; // total / distinct months
  annualCost: number;
  frequency: string; // weekly | biweekly | monthly | irregular
  variableAmount: boolean;
  multiPerMonth: boolean; // 2+ charges in some month — possible double-bill
  lastDate: string;
  priceChange: PriceChange | null; // recent stable price differs from the prior one
  lapsed: boolean; // no charge for >2× its cadence (measured at the data edge)
  markedAt: string | null; // user marked this to cancel (subscription_marks)
  markedMonthlyCost: number; // snapshot at mark time — the "saving $/yr" figure
  chargedSinceMark: number; // $ that still went out after the mark date
}

// Merchants that are recurring even when the amount varies (usage-based plans).
const KNOWN_RECURRING = [
  "YOUTUBE", "GOOGLE ONE", "PRIME", "CLASSPASS", "STRAVA", "CLAUDE",
  "NETFLIX", "SPOTIFY", "ROGERS", "TELUS", "DISNEY", "AUDIBLE", "ICLOUD",
  "APPLE.COM/BILL", "AMAZON MUSIC", "SP+AFF",
];

// Expected days between charges per cadence label; a sub is "lapsed" when the
// data edge is more than 2× this past its last charge. Irregular cadences
// can't support the inference.
const CADENCE_GAP_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 31,
  "every ~2 months": 61,
};

interface Row {
  description: string;
  amount: number;
  txn_date: string;
  category: string;
}

// Group key: uppercased alpha-ish prefix, which collapses the trailing
// store numbers / locations that vary per charge.
function merchantKey(desc: string): string {
  return desc.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 14);
}

// A price change is only credible when BOTH sides are stable: the earlier
// charges sat within ±15% of their median (a real plan price, not usage
// noise) and the last two charges agree within 2% (the new price has stuck).
function detectPriceChange(sorted: Row[]): PriceChange | null {
  if (sorted.length < 5) return null;
  const amounts = sorted.map((r) => r.amount);
  const prior = amounts.slice(0, -2);
  const recent = amounts.slice(-2);
  const priorMed = median(prior);
  if (!priorMed) return null;
  const priorStable =
    (Math.max(...prior) - Math.min(...prior)) / priorMed <= 0.15;
  const recentStable =
    Math.abs(recent[1] - recent[0]) / (recent[1] || 1) <= 0.02;
  if (!priorStable || !recentStable) return null;
  const recentMed = median(recent);
  const pct = (recentMed - priorMed) / priorMed;
  if (Math.abs(pct) < 0.05) return null;
  return {
    from: priorMed,
    to: recentMed,
    pct: Math.round(pct * 100),
  };
}

export function getSubscriptions(): { subscriptions: Subscription[]; monthlyTotal: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT description, amount, txn_date, effective_category AS category
       FROM v_transactions
       WHERE ${SPEND_WHERE} AND amount > 0`
    )
    .all() as Row[];

  // Lapse detection compares against the newest SPEND date in the data —
  // never new Date(); statements lag the calendar (see CLAUDE.md).
  let dataEdge = "";
  for (const r of rows) if (r.txn_date > dataEdge) dataEdge = r.txn_date;

  const marks = new Map(
    (
      db
        .prepare(
          `SELECT slug, marked_at, monthly_cost FROM subscription_marks`
        )
        .all() as { slug: string; marked_at: string; monthly_cost: number }[]
    ).map((m) => [m.slug, m])
  );

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = merchantKey(r.description);
    if (!groups.get(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const subs: Subscription[] = [];
  for (const items of groups.values()) {
    const amounts = items.map((i) => i.amount);
    const monthsSet = new Set(items.map((i) => i.txn_date.slice(0, 7)));
    const months = monthsSet.size;
    if (months < 3) continue;

    const perMonth = items.length / months;
    const med = median(amounts);
    const range = (Math.max(...amounts) - Math.min(...amounts)) / (med || 1);
    const known = KNOWN_RECURRING.some((kw) =>
      items[0].description.toUpperCase().includes(kw)
    );

    // Recurring if it shows up ~monthly with a stable amount, OR it's a known
    // recurring merchant (catches usage-based plans with variable amounts).
    const recurring = (perMonth <= 2.5 && range <= 0.15) || known;
    const sorted = items.slice().sort((a, b) => a.txn_date.localeCompare(b.txn_date));
    // A clean price step (stable before, stable after) pushes the all-time
    // range past 0.15 and would otherwise hide the sub — let it through.
    const priceChange = detectPriceChange(sorted);
    if (!recurring && !(perMonth <= 2.5 && priceChange)) continue;

    const total = amounts.reduce((s, a) => s + a, 0);
    const monthlyCost = total / months;
    const frequency = frequencyLabel(items.map((i) => i.txn_date));

    // Possible double-bill: a normally-MONTHLY subscription that was charged 2+
    // times in some month (biweekly/weekly merchants are expected to repeat, so
    // they don't count). This is the Claude.ai "verify you're not double-subbed".
    const perMonthCounts = new Map<string, number>();
    for (const i of items) {
      const m = i.txn_date.slice(0, 7);
      perMonthCounts.set(m, (perMonthCounts.get(m) || 0) + 1);
    }
    const multiPerMonth =
      frequency === "monthly" && [...perMonthCounts.values()].some((c) => c >= 2);

    const lastDate = sorted[sorted.length - 1].txn_date;
    const gap = CADENCE_GAP_DAYS[frequency];
    const lapsed =
      !!gap &&
      (new Date(dataEdge + "T00:00:00").getTime() -
        new Date(lastDate + "T00:00:00").getTime()) /
        86400000 >
        2 * gap;

    const slug = merchantSlug(items[0].description);
    const mark = marks.get(slug);
    const chargedSinceMark = mark
      ? sorted
          .filter((i) => i.txn_date > mark.marked_at)
          .reduce((s, i) => s + i.amount, 0)
      : 0;

    subs.push({
      merchant: merchantDisplay(items[0].description),
      slug,
      category: items[0].category,
      charges: items.length,
      months,
      typical: med,
      monthlyCost,
      annualCost: monthlyCost * 12,
      frequency,
      // A detected price step explains the spread — don't also call it variable.
      variableAmount: range > 0.15 && !priceChange,
      multiPerMonth,
      lastDate,
      priceChange,
      lapsed,
      markedAt: mark?.marked_at ?? null,
      markedMonthlyCost: mark?.monthly_cost ?? 0,
      chargedSinceMark,
    });
  }

  subs.sort((a, b) => b.monthlyCost - a.monthlyCost);
  // Lapsed subs stay listed (the user should see they're gone) but don't
  // count toward the live monthly total.
  const monthlyTotal = subs
    .filter((s) => !s.lapsed)
    .reduce((s, x) => s + x.monthlyCost, 0);
  return { subscriptions: subs, monthlyTotal };
}

export function markSubscription(
  slug: string,
  merchant: string,
  monthlyCost: number,
  markedAt?: string
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO subscription_marks (slug, merchant, marked_at, monthly_cost)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       merchant = excluded.merchant,
       marked_at = excluded.marked_at,
       monthly_cost = excluded.monthly_cost`
  ).run(slug, merchant, markedAt ?? new Date().toISOString().slice(0, 10), monthlyCost);
}

export function unmarkSubscription(slug: string): void {
  getDb().prepare(`DELETE FROM subscription_marks WHERE slug = ?`).run(slug);
}
