import { getDb } from "../db";

export interface MonthlyTotal {
  month: string;
  total: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  count: number;
}

export interface TrendPoint {
  month: string;
  category: string;
  total: number;
}

export interface TopMerchant {
  description: string;
  total: number;
  count: number;
}

export function getMonthlyTotals(months: number = 12): MonthlyTotal[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS month, SUM(amount) AS total
       FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
       GROUP BY month
       ORDER BY month DESC
       LIMIT @months`
    )
    .all({ months }) as MonthlyTotal[];
}

export function getCategoryBreakdown(month?: string): CategoryBreakdown[] {
  const db = getDb();
  const where = month
    ? "AND substr(txn_date, 1, 7) = @month"
    : "";
  return db
    .prepare(
      `SELECT effective_category AS category, SUM(amount) AS total, COUNT(*) AS count
       FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa') ${where}
       GROUP BY effective_category
       ORDER BY total DESC`
    )
    .all(month ? { month } : {}) as CategoryBreakdown[];
}

export function getTrends(months: number = 6): TrendPoint[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS month, effective_category AS category, SUM(amount) AS total
       FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
         AND substr(txn_date, 1, 7) >= (
           SELECT substr(txn_date, 1, 7) FROM v_transactions
           WHERE flow = 'spend' ORDER BY txn_date ASC LIMIT 1
         )
       GROUP BY month, category
       ORDER BY month, total DESC`
    )
    .all() as TrendPoint[];
}

export function getTopMerchants(limit: number = 10, month?: string, category?: string): TopMerchant[] {
  const db = getDb();
  const conditions = ["flow = 'spend'", "source IN ('amex', 'cibc_visa')"];
  const params: Record<string, unknown> = { limit };
  if (month) {
    conditions.push("substr(txn_date, 1, 7) = @month");
    params.month = month;
  }
  if (category) {
    conditions.push("effective_category = @category");
    params.category = category;
  }
  return db
    .prepare(
      `SELECT description, SUM(amount) AS total, COUNT(*) AS count
       FROM v_transactions
       WHERE ${conditions.join(" AND ")}
       GROUP BY description
       ORDER BY total DESC
       LIMIT @limit`
    )
    .all(params) as TopMerchant[];
}
