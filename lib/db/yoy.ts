import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";

// Year-over-year spend comparison (the BY CATEGORY tab's YEAR OVER YEAR
// section): the latest data month vs the same calendar month last year
// (total + per-category), plus the last 12 calendar months overlaid on the
// 12 before them, aligned by month offset.
//
// Universes follow the app-wide split: amount-only monthly totals read
// v_transactions (whole parents — splits never move totals), per-category
// aggregation reads v_category_slices (split parts count under their own
// categories, same as insights/summary).

export interface YoyCategoryDelta {
  category: string;
  current: number; // latest data month
  previous: number; // same month last year
  delta: number; // current - previous
  pct: number | null; // delta / previous * 100; null when previous is 0 (new category)
}

export interface YoyMonthPoint {
  offset: number; // 0..11, chart x position (0 = 11 months before the latest)
  month: string; // this-year calendar month (YYYY-MM)
  total: number; // this-year spend (0 when the month had none)
  prevMonth: string; // the month exactly 12 calendar months earlier
  prevTotal: number | null; // last-year spend; null when prevMonth predates the data
}

export interface YoySummary {
  hasFullYear: boolean; // >= 13 distinct spend months — the compare is meaningful
  monthsOfData: number; // distinct months with spend data
  latestMonth: string | null; // latest data month (YYYY-MM)
  comparisonMonth: string | null; // latestMonth - 12
  latestTotal: number;
  comparisonTotal: number;
  totalDelta: number;
  totalPct: number | null; // null when comparisonTotal is 0
  categories: YoyCategoryDelta[]; // latest vs same-month-last-year, biggest |delta| first
  months: YoyMonthPoint[]; // 12 aligned overlay points, oldest first
}

// "2026-03" shifted by delta calendar months.
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
  const idx = y * 12 + (m - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getYoy(): YoySummary {
  const db = getDb();

  // Distinct spend months, ascending. 13 distinct YYYY-MM values guarantee the
  // first is at least 12 calendar months before the latest, so the comparison
  // month is always inside data coverage (even if it happens to hold no spend).
  const dataMonths = (
    db
      .prepare(
        `SELECT DISTINCT substr(txn_date, 1, 7) AS m FROM v_transactions
         WHERE ${SPEND_WHERE} ORDER BY m`
      )
      .all() as { m: string }[]
  ).map((r) => r.m);

  const monthsOfData = dataMonths.length;
  const latestMonth = monthsOfData ? dataMonths[monthsOfData - 1] : null;

  if (!latestMonth || monthsOfData < 13) {
    return {
      hasFullYear: false,
      monthsOfData,
      latestMonth,
      comparisonMonth: null,
      latestTotal: 0,
      comparisonTotal: 0,
      totalDelta: 0,
      totalPct: null,
      categories: [],
      months: [],
    };
  }

  const firstMonth = dataMonths[0];
  const comparisonMonth = shiftMonth(latestMonth, -12);

  // Whole-parent monthly totals (small table — read them all, map in TS).
  const totalsByMonth = new Map(
    (
      db
        .prepare(
          `SELECT substr(txn_date, 1, 7) AS month, SUM(amount) AS total
           FROM v_transactions
           WHERE ${SPEND_WHERE}
           GROUP BY month`
        )
        .all() as { month: string; total: number }[]
    ).map((r) => [r.month, r.total])
  );

  // 12 aligned overlay points, ending at the latest data month.
  const months: YoyMonthPoint[] = [];
  for (let offset = 0; offset < 12; offset++) {
    const month = shiftMonth(latestMonth, offset - 11);
    const prevMonth = shiftMonth(month, -12);
    months.push({
      offset,
      month,
      total: totalsByMonth.get(month) ?? 0,
      prevMonth,
      // A covered month with no rows spent $0; a month before the first data
      // month is unknown, not zero — the chart must not draw it as a low.
      prevTotal: prevMonth >= firstMonth ? (totalsByMonth.get(prevMonth) ?? 0) : null,
    });
  }

  // Per-category, latest month vs the same month last year, through the slice
  // view so split parts count under their own categories.
  const catRows = db
    .prepare(
      `SELECT effective_category AS category, substr(txn_date, 1, 7) AS month,
              SUM(amount) AS total
       FROM v_category_slices
       WHERE ${SPEND_WHERE} AND substr(txn_date, 1, 7) IN (@cur, @prev)
       GROUP BY category, month`
    )
    .all({ cur: latestMonth, prev: comparisonMonth }) as {
    category: string;
    month: string;
    total: number;
  }[];

  const byCategory = new Map<string, { current: number; previous: number }>();
  for (const r of catRows) {
    const entry = byCategory.get(r.category) ?? { current: 0, previous: 0 };
    if (r.month === latestMonth) entry.current = r.total;
    else entry.previous = r.total;
    byCategory.set(r.category, entry);
  }

  const categories: YoyCategoryDelta[] = [...byCategory.entries()]
    .map(([category, { current, previous }]) => ({
      category,
      current,
      previous,
      delta: current - previous,
      pct: previous > 0 ? ((current - previous) / previous) * 100 : null,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const latestTotal = totalsByMonth.get(latestMonth) ?? 0;
  const comparisonTotal = totalsByMonth.get(comparisonMonth) ?? 0;

  return {
    hasFullYear: true,
    monthsOfData,
    latestMonth,
    comparisonMonth,
    latestTotal,
    comparisonTotal,
    totalDelta: latestTotal - comparisonTotal,
    totalPct:
      comparisonTotal > 0 ? ((latestTotal - comparisonTotal) / comparisonTotal) * 100 : null,
    categories,
    months,
  };
}
