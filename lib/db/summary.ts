import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";

export interface MonthlyTotal {
  month: string;
  total: number;
  count: number; // distinct spend transactions in the month (parent-level, split-immune)
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
      `SELECT substr(txn_date, 1, 7) AS month, SUM(amount) AS total, COUNT(*) AS count
       FROM v_transactions
       WHERE ${SPEND_WHERE}
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
  // Slice view: split transactions count each part under its own category
  // (totals still reconcile with getMonthlyTotals — slices sum to parents).
  // DISTINCT transaction_id so a split parent is one transaction, not N.
  return db
    .prepare(
      `SELECT effective_category AS category, SUM(amount) AS total,
              COUNT(DISTINCT transaction_id) AS count
       FROM v_category_slices
       WHERE ${SPEND_WHERE} ${where}
       GROUP BY effective_category
       ORDER BY total DESC`
    )
    .all(month ? { month } : {}) as CategoryBreakdown[];
}

export function getTrends(): TrendPoint[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS month, effective_category AS category, SUM(amount) AS total
       FROM v_category_slices
       WHERE ${SPEND_WHERE}
       GROUP BY month, category
       ORDER BY month, total DESC`
    )
    .all() as TrendPoint[];
}

export function getTopMerchants(limit: number = 10, month?: string, category?: string): TopMerchant[] {
  const db = getDb();
  const conditions = ["flow = 'spend'", "account_kind = 'card'"];
  const params: Record<string, unknown> = { limit };
  if (month) {
    conditions.push("substr(txn_date, 1, 7) = @month");
    params.month = month;
  }
  if (category) {
    conditions.push("effective_category = @category");
    params.category = category;
  }
  // Only the category-filtered branch reads the slice view (a split parent
  // matches for any part, contributing the PART's amount; DISTINCT parent
  // count). The unfiltered branch stays on v_transactions — whole charges per
  // merchant, one row per transaction.
  const source = category ? "v_category_slices" : "v_transactions";
  const countExpr = category ? "COUNT(DISTINCT transaction_id)" : "COUNT(*)";
  return db
    .prepare(
      `SELECT description, SUM(amount) AS total, ${countExpr} AS count
       FROM ${source}
       WHERE ${conditions.join(" AND ")}
       GROUP BY description
       ORDER BY total DESC
       LIMIT @limit`
    )
    .all(params) as TopMerchant[];
}
