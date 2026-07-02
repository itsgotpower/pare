import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";
import { merchantDisplay, merchantSlug } from "../merchant-key";
import { median, frequencyLabel } from "./stats";

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
}

// Merchants that are recurring even when the amount varies (usage-based plans).
const KNOWN_RECURRING = [
  "YOUTUBE", "GOOGLE ONE", "PRIME", "CLASSPASS", "STRAVA", "CLAUDE",
  "NETFLIX", "SPOTIFY", "ROGERS", "TELUS", "DISNEY", "AUDIBLE", "ICLOUD",
  "APPLE.COM/BILL", "AMAZON MUSIC", "SP+AFF",
];

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

export function getSubscriptions(): { subscriptions: Subscription[]; monthlyTotal: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT description, amount, txn_date, effective_category AS category
       FROM v_transactions
       WHERE ${SPEND_WHERE} AND amount > 0`
    )
    .all() as Row[];

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
    if (!recurring) continue;

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

    subs.push({
      merchant: merchantDisplay(items[0].description),
      slug: merchantSlug(items[0].description),
      category: items[0].category,
      charges: items.length,
      months,
      typical: med,
      monthlyCost,
      annualCost: monthlyCost * 12,
      frequency,
      variableAmount: range > 0.15,
      multiPerMonth,
      lastDate: items.map((i) => i.txn_date).sort().slice(-1)[0],
    });
  }

  subs.sort((a, b) => b.monthlyCost - a.monthlyCost);
  const monthlyTotal = subs.reduce((s, x) => s + x.monthlyCost, 0);
  return { subscriptions: subs, monthlyTotal };
}
