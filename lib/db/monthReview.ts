import { getDb } from "../db";
import { OUTFLOW_WHERE } from "./account-kinds";
import { getIncomeVsSpend } from "./income";
import { getTopMerchants, type TopMerchant } from "./summary";

// One month of the trend: money in, money out (fixed + variable), net saved, and
// the savings rate (net / income; null when there's no income that month so the
// chart can skip the point rather than draw a misleading 0%).
export interface MonthTrendPoint {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number | null;
}

export interface ReviewCategory {
  category: string;
  total: number;
  count: number;
}

export interface BiggestMonth {
  month: string;
  total: number;
}

// Everything the REVIEW tab needs for one selected month, in a single payload.
//
// `month` is the resolved selection (the latest month with data when the caller
// passes nothing or an unknown month). In/out/net for the month come from the
// same expense universe as the CASHFLOW / INCOME tabs (OUTFLOW_WHERE — card spend
// + chequing debits/fees + categorized transfers like rent), so top categories
// tie to total out and `income − spend = net` holds.
export interface MonthReview {
  months: string[]; // selectable months with activity, ascending
  month: string | null; // resolved selection, null only when there is no data

  // Headline figures for `month`.
  income: number;
  fixed: number;
  variable: number;
  spend: number;
  net: number;
  savingsRate: number | null;
  txnCount: number;

  // Month-over-month deltas vs the previous month with data (null if none).
  prevMonth: string | null;
  incomeDelta: number | null;
  spendDelta: number | null;
  netDelta: number | null;

  // Detail for `month`.
  topCategories: ReviewCategory[];
  topMerchants: TopMerchant[];

  // Across the whole data window.
  trend: MonthTrendPoint[]; // every month, ascending
  biggestMonths: BiggestMonth[]; // by spend, descending
  avgIncome: number;
  avgSpend: number;
  avgSavingsRate: number | null;
}

const rate = (net: number, income: number): number | null =>
  income > 0 ? net / income : null;

function empty(): MonthReview {
  return {
    months: [],
    month: null,
    income: 0,
    fixed: 0,
    variable: 0,
    spend: 0,
    net: 0,
    savingsRate: null,
    txnCount: 0,
    prevMonth: null,
    incomeDelta: null,
    spendDelta: null,
    netDelta: null,
    topCategories: [],
    topMerchants: [],
    trend: [],
    biggestMonths: [],
    avgIncome: 0,
    avgSpend: 0,
    avgSavingsRate: null,
  };
}

// Month-in-review aggregate: a single month's recap plus the trend it sits in.
// Built on getIncomeVsSpend() (shared expense universe) so the whole report —
// headline, trend, biggest months, averages — is internally consistent; the
// per-month category and merchant detail are the only extra queries.
export function getMonthReview(month?: string): MonthReview {
  const db = getDb();

  // income.ts already splits each month into income / fixed / variable over the
  // OUTFLOW_WHERE universe, ascending. Derive spend / net / savings rate from it.
  const ivs = getIncomeVsSpend();
  if (ivs.length === 0) return empty();

  const trend: MonthTrendPoint[] = ivs.map((m) => {
    const spend = m.fixed + m.variable;
    const net = m.income - spend;
    return { month: m.month, income: m.income, spend, net, savingsRate: rate(net, m.income) };
  });
  const months = trend.map((t) => t.month);

  const selected = month && months.includes(month) ? month : months[months.length - 1];
  const idx = months.indexOf(selected);
  const row = trend[idx];
  const ivsRow = ivs[idx];
  const prev = idx > 0 ? trend[idx - 1] : null;

  // Top categories for the month over the full outflow universe, so they sum to
  // `spend` (rent + chequing debits included, not card-only).
  const topCategories = db
    .prepare(
      // Slice view + DISTINCT parent count: a split transaction spreads its
      // dollars across categories but stays ONE transaction in txnCount.
      `SELECT effective_category AS category, SUM(amount) AS total,
              COUNT(DISTINCT transaction_id) AS count
       FROM v_category_slices
       WHERE ${OUTFLOW_WHERE} AND substr(txn_date, 1, 7) = @month
       GROUP BY category
       ORDER BY total DESC`
    )
    .all({ month: selected }) as ReviewCategory[];

  const txnCount = topCategories.reduce((s, c) => s + c.count, 0);
  const topMerchants = getTopMerchants(5, selected);

  const biggestMonths = [...trend]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)
    .map((t) => ({ month: t.month, total: t.spend }));

  const totalIncome = trend.reduce((s, t) => s + t.income, 0);
  const totalSpend = trend.reduce((s, t) => s + t.spend, 0);
  const totalNet = totalIncome - totalSpend;

  return {
    months,
    month: selected,
    income: row.income,
    fixed: ivsRow.fixed,
    variable: ivsRow.variable,
    spend: row.spend,
    net: row.net,
    savingsRate: row.savingsRate,
    txnCount,
    prevMonth: prev?.month ?? null,
    incomeDelta: prev ? row.income - prev.income : null,
    spendDelta: prev ? row.spend - prev.spend : null,
    netDelta: prev ? row.net - prev.net : null,
    topCategories,
    topMerchants,
    trend,
    biggestMonths,
    avgIncome: totalIncome / trend.length,
    avgSpend: totalSpend / trend.length,
    avgSavingsRate: rate(totalNet, totalIncome),
  };
}
