import { getDb } from "../db";

export interface MonthlyIncome {
  month: string;
  total: number;
}

export interface IncomeType {
  type: string;
  total: number;
  count: number;
}

export interface IncomeVsSpend {
  month: string;
  income: number;
  fixed: number;
  variable: number;
}

export const TYPE_CASE = `
  CASE
    WHEN UPPER(description) LIKE '%PEOPLE CENTER%' OR UPPER(description) LIKE '%PAYROLL%' THEN 'Payroll'
    WHEN UPPER(description) LIKE '%REFUND%' OR UPPER(description) LIKE '%REMBOURS%' THEN 'Tax refund'
    WHEN UPPER(description) LIKE '%HEALTHCLAIM%' THEN 'Health claim'
    WHEN UPPER(description) LIKE '%PAYOUT%' THEN 'Winnings'
    ELSE 'Other'
  END
`;

export const FIXED_CATEGORIES = `('Rent / housing', 'Phone / utilities')`;

export function getMonthlyIncome(months: number = 12): MonthlyIncome[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS month, SUM(amount) AS total
       FROM v_transactions
       WHERE flow = 'income'
       GROUP BY month
       ORDER BY month DESC
       LIMIT @months`
    )
    .all({ months }) as MonthlyIncome[];
}

export function getIncomeByType(): IncomeType[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT ${TYPE_CASE} AS type, SUM(amount) AS total, COUNT(*) AS count
       FROM v_transactions
       WHERE flow = 'income'
       GROUP BY type
       ORDER BY total DESC`
    )
    .all() as IncomeType[];
}

// Monthly income alongside fixed and variable expenses.
//
// Expenses include:
//   - Card spend (amex / cibc_visa, flow='spend')
//   - Chequing direct debits (flow='spend')
//   - Chequing bank fees (flow='fee_interest')
//   - Chequing transfers that have been categorized (category != 'Banking',
//     e.g. rent tagged via an in-app rule)
//
// Fixed = categories in FIXED_CATEGORIES + chequing bank fees.
// Variable = everything else.
//
// Card payments (flow='payment') are excluded to avoid double-counting.
export function getIncomeVsSpend(): IncomeVsSpend[] {
  const db = getDb();
  return db
    .prepare(
      `WITH inc AS (
         SELECT substr(txn_date, 1, 7) AS month, SUM(amount) AS income
         FROM v_transactions WHERE flow = 'income' GROUP BY month
       ),
       expenses AS (
         SELECT substr(txn_date, 1, 7) AS month,
           CASE
             WHEN effective_category IN ${FIXED_CATEGORIES} THEN 'fixed'
             WHEN source = 'cibc_chequing' AND flow = 'fee_interest' THEN 'fixed'
             ELSE 'variable'
           END AS etype,
           amount
         FROM v_transactions
         WHERE
           (flow = 'spend' AND source IN ('amex', 'cibc_visa'))
           OR (source = 'cibc_chequing' AND flow = 'spend')
           OR (source = 'cibc_chequing' AND flow = 'fee_interest')
           OR (source = 'cibc_chequing' AND flow = 'transfer' AND effective_category != 'Banking')
       ),
       fix AS (
         SELECT month, SUM(amount) AS fixed FROM expenses WHERE etype = 'fixed' GROUP BY month
       ),
       var AS (
         SELECT month, SUM(amount) AS variable FROM expenses WHERE etype = 'variable' GROUP BY month
       ),
       months AS (
         SELECT month FROM inc UNION SELECT month FROM fix UNION SELECT month FROM var
       )
       SELECT m.month AS month,
              COALESCE(inc.income, 0) AS income,
              COALESCE(fix.fixed, 0) AS fixed,
              COALESCE(var.variable, 0) AS variable
       FROM months m
       LEFT JOIN inc ON inc.month = m.month
       LEFT JOIN fix ON fix.month = m.month
       LEFT JOIN var ON var.month = m.month
       ORDER BY m.month`
    )
    .all() as IncomeVsSpend[];
}
