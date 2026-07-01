import { getDb } from "../db";
import { OUTFLOW_WHERE } from "./account-kinds";
import { getIncomeVsSpend, FIXED_CATEGORIES, PAYROLL_WHERE } from "./income";
import { getSubscriptions } from "./subscriptions";
import { median } from "./stats";

export interface CategoryPace {
  category: string;
  soFar: number;
  projected: number;
  typical: number; // mean over the basis months
}

export interface Forecast {
  targetMonth: string; // calendar month being forecast (YYYY-MM)
  mode: "pace" | "average"; // pace = partial-month data exists; average = no data yet
  daysOfData: number; // pace mode: last day of data in targetMonth
  daysInMonth: number;
  projectedIncome: number; // payroll only — one-off refunds/winnings excluded
  projectedFixed: number;
  projectedVariable: number;
  projectedNet: number;
  recurringMonthly: number; // committed subscriptions (context)
  basisMonths: string[]; // complete months the averages come from
  categories: CategoryPace[]; // pace mode only, sorted by projected desc
}

// Same expense universe as getIncomeVsSpend / getCashflow (account_kind-keyed,
// shared from account-kinds.ts so imported foreign accounts join in too).
const EXPENSE_WHERE = OUTFLOW_WHERE;

// Forecast the current CALENDAR month (statements lag, so this is usually a
// month with little or no data — unlike the dashboards, which use the latest
// data month). Income is projected from payroll only; fixed and variable come
// from the median of the last 3 complete months (median, not mean, so one
// big-purchase month doesn't inflate the forecast). When partial current-month
// data exists (≥ 5 days), variable spend switches to pace: so-far ÷ days
// elapsed × days in month, with a per-category breakdown vs typical.
export function getForecast(now: Date = new Date()): Forecast | null {
  const db = getDb();

  const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const complete = getIncomeVsSpend().filter(
    (m) => m.income > 0 && m.month < targetMonth
  );
  if (complete.length === 0) return null;

  const basis = complete.slice(-3);
  const basisMonths = basis.map((m) => m.month);
  const basisList = basisMonths.map((m) => `'${m}'`).join(",");

  // Payroll per basis month → projected income (mean; payroll is stable).
  const payroll = db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS m, SUM(amount) AS t
       FROM v_transactions
       WHERE flow = 'income'
         AND ${PAYROLL_WHERE}
         AND substr(txn_date, 1, 7) IN (${basisList})
       GROUP BY m`
    )
    .all() as { m: string; t: number }[];
  const projectedIncome =
    payroll.reduce((s, r) => s + r.t, 0) / basisMonths.length;

  const projectedFixed = median(basis.map((m) => m.fixed));
  let projectedVariable = median(basis.map((m) => m.variable));

  // Partial current-month data?
  const cur = db
    .prepare(
      `SELECT effective_category AS category, SUM(amount) AS total,
              MAX(CAST(substr(txn_date, 9, 2) AS INTEGER)) AS lastDay
       FROM v_transactions
       WHERE ${EXPENSE_WHERE} AND substr(txn_date, 1, 7) = @month
         AND effective_category NOT IN ${FIXED_CATEGORIES}
         AND NOT (account_kind = 'chequing' AND flow = 'fee_interest')
       GROUP BY category`
    )
    .all({ month: targetMonth }) as {
    category: string;
    total: number;
    lastDay: number;
  }[];

  const daysOfData = cur.reduce((d, r) => Math.max(d, r.lastDay), 0);
  let mode: Forecast["mode"] = "average";
  let categories: CategoryPace[] = [];

  if (daysOfData >= 5) {
    mode = "pace";
    const typicalRows = db
      .prepare(
        `SELECT effective_category AS category, SUM(amount) / ${basisMonths.length}.0 AS typical
         FROM v_transactions
         WHERE ${EXPENSE_WHERE} AND substr(txn_date, 1, 7) IN (${basisList})
           AND effective_category NOT IN ${FIXED_CATEGORIES}
           AND NOT (account_kind = 'chequing' AND flow = 'fee_interest')
         GROUP BY category`
      )
      .all() as { category: string; typical: number }[];
    const typicalMap = new Map(typicalRows.map((r) => [r.category, r.typical]));

    categories = cur
      .map((r) => ({
        category: r.category,
        soFar: r.total,
        projected: (r.total / daysOfData) * daysInMonth,
        typical: typicalMap.get(r.category) ?? 0,
      }))
      .sort((a, b) => b.projected - a.projected);

    projectedVariable = categories.reduce((s, c) => s + c.projected, 0);
  }

  return {
    targetMonth,
    mode,
    daysOfData,
    daysInMonth,
    projectedIncome,
    projectedFixed,
    projectedVariable,
    projectedNet: projectedIncome - projectedFixed - projectedVariable,
    recurringMonthly: getSubscriptions().monthlyTotal,
    basisMonths,
    categories,
  };
}
