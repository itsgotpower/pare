import { getDb } from "../db";
import { CARD_SPEND_WHERE } from "./account-kinds";
import { merchantDisplay, merchantSlug } from "../merchant-key";

// Merchant drill-down queries. A "merchant" is the group of card-spend rows that
// share a normalized slug (see lib/merchant-key.ts) — this collapses the per-charge
// store-number / location noise so one brand reads as one merchant.
//
// Scope = the SAME spend universe as the dashboard charts, subscriptions, and
// top-merchants: CARD_SPEND_WHERE (flow='spend' AND account_kind='card').
// Chequing debits are intentionally excluded so the totals here reconcile with
// what's shown elsewhere. Grouping happens in JS (personal-scale row counts),
// mirroring how subscriptions.ts already fetches-then-groups.

export interface MerchantSummary {
  slug: string; // URL id + grouping key
  merchant: string; // display name
  category: string; // dominant category (by spend)
  total: number;
  count: number;
  avg: number; // total / count
  months: number; // distinct YYYY-MM seen
  firstDate: string;
  lastDate: string;
}

export interface MerchantMonthly {
  month: string; // YYYY-MM
  total: number;
  count: number;
}

export interface MerchantCategorySplit {
  category: string;
  total: number;
  count: number;
}

export interface MerchantTxn {
  id: number;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  source: string;
}

export interface MerchantDetail {
  slug: string;
  merchant: string;
  total: number;
  count: number;
  avg: number; // mean charge
  typical: number; // median charge
  months: number; // distinct months seen
  monthlyAvg: number; // total / distinct months
  firstDate: string;
  lastDate: string;
  frequency: string; // weekly | biweekly | monthly | ...
  monthly: MerchantMonthly[]; // ascending by month
  categories: MerchantCategorySplit[]; // descending by total
  transactions: MerchantTxn[]; // descending by date
}

interface Row {
  id: number;
  description: string;
  amount: number;
  txn_date: string;
  category: string;
  source: string;
}

// Same "card spend" universe as the dashboard charts / subscriptions, keyed off
// account_kind (Part 2 refactor) so imported card data lights up here too.
const SPEND_WHERE = `${CARD_SPEND_WHERE} AND amount > 0`;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Median inter-charge gap → a human frequency label (same buckets as the
// recurring detector, so a subscription and its merchant page read consistently).
function frequencyLabel(dates: string[]): string {
  if (dates.length < 2) return "one-off";
  const days = dates
    .map((d) => new Date(d + "T00:00:00").getTime())
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / 86400000);
  const g = median(gaps);
  if (g <= 10) return "weekly";
  if (g <= 20) return "biweekly";
  if (g <= 45) return "monthly";
  if (g <= 75) return "every ~2 months";
  return "irregular";
}

// Pick the most common display name in the group (stable label even when the
// representative row order shifts), tie-broken toward the longest.
function dominantDisplay(items: Row[]): string {
  const counts = new Map<string, number>();
  for (const r of items) {
    const d = merchantDisplay(r.description);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length
  )[0][0];
}

// Dominant category by total spend (a merchant can hit several categories when a
// row is manually overridden).
function dominantCategory(items: Row[]): string {
  const byCat = new Map<string, number>();
  for (const r of items) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  return [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function fetchSpendRows(): Row[] {
  return getDb()
    .prepare(
      `SELECT id, description, amount, txn_date, effective_category AS category, source
       FROM v_transactions
       WHERE ${SPEND_WHERE}`
    )
    .all() as Row[];
}

function groupBySlug(rows: Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const slug = merchantSlug(r.description);
    let g = groups.get(slug);
    if (!g) groups.set(slug, (g = []));
    g.push(r);
  }
  return groups;
}

// The merchant index: every card-spend merchant, biggest spend first.
export function getMerchants(): MerchantSummary[] {
  const groups = groupBySlug(fetchSpendRows());
  const out: MerchantSummary[] = [];
  for (const [slug, items] of groups) {
    const total = items.reduce((s, i) => s + i.amount, 0);
    const dates = items.map((i) => i.txn_date).sort();
    const months = new Set(items.map((i) => i.txn_date.slice(0, 7))).size;
    out.push({
      slug,
      merchant: dominantDisplay(items),
      category: dominantCategory(items),
      total,
      count: items.length,
      avg: total / items.length,
      months,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

// One merchant's full history: stats, monthly trend, category split, and every
// transaction. Returns null if the slug matches no card spend.
export function getMerchantDetail(slug: string): MerchantDetail | null {
  const items = fetchSpendRows().filter((r) => merchantSlug(r.description) === slug);
  if (items.length === 0) return null;

  const amounts = items.map((i) => i.amount);
  const total = amounts.reduce((s, a) => s + a, 0);
  const dates = items.map((i) => i.txn_date).sort();
  const months = new Set(items.map((i) => i.txn_date.slice(0, 7))).size;

  const monthlyMap = new Map<string, { total: number; count: number }>();
  for (const i of items) {
    const m = i.txn_date.slice(0, 7);
    const cur = monthlyMap.get(m) ?? { total: 0, count: 0 };
    cur.total += i.amount;
    cur.count += 1;
    monthlyMap.set(m, cur);
  }
  const monthly: MerchantMonthly[] = [...monthlyMap.entries()]
    .map(([month, v]) => ({ month, total: v.total, count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const catMap = new Map<string, { total: number; count: number }>();
  for (const i of items) {
    const cur = catMap.get(i.category) ?? { total: 0, count: 0 };
    cur.total += i.amount;
    cur.count += 1;
    catMap.set(i.category, cur);
  }
  const categories: MerchantCategorySplit[] = [...catMap.entries()]
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);

  const transactions: MerchantTxn[] = items
    .map((i) => ({
      id: i.id,
      txn_date: i.txn_date,
      description: i.description,
      amount: i.amount,
      category: i.category,
      source: i.source,
    }))
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.id - a.id);

  return {
    slug,
    merchant: dominantDisplay(items),
    total,
    count: items.length,
    avg: total / items.length,
    typical: median(amounts),
    months,
    monthlyAvg: total / months,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    frequency: frequencyLabel(items.map((i) => i.txn_date)),
    monthly,
    categories,
    transactions,
  };
}
