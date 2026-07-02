import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";

export interface SpendingGoal {
  id: number;
  category: string;
  monthly_limit: number;
  active: number;
  created_at: string;
}

export interface GoalProgress {
  category: string;
  monthly_limit: number;
  spent: number;
  remaining: number;
  percentage: number;
}

export function listGoals(): SpendingGoal[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM spending_goals WHERE active = 1 ORDER BY category")
    .all() as SpendingGoal[];
}

export function upsertGoal(category: string, monthlyLimit: number): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO spending_goals (category, monthly_limit)
     VALUES (?, ?)
     ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit, active = 1`
  ).run(category, monthlyLimit);
}

export function deleteGoal(id: number): void {
  const db = getDb();
  db.prepare("UPDATE spending_goals SET active = 0 WHERE id = ?").run(id);
}

export interface CategoryAverage {
  category: string;
  avg_monthly: number;
}

// Per-category average monthly card spend over the data window — the source for
// suggested goal limits.
export function getCategoryAverages(): CategoryAverage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT effective_category AS category,
              AVG(monthly_total) AS avg_monthly
       FROM (
         SELECT effective_category, substr(txn_date, 1, 7) AS month, SUM(amount) AS monthly_total
         FROM v_transactions
         WHERE ${SPEND_WHERE}
         GROUP BY effective_category, month
       )
       GROUP BY category
       ORDER BY avg_monthly DESC`
    )
    .all() as CategoryAverage[];
}

export function getCurrentProgress(): GoalProgress[] {
  const db = getDb();
  // Use the latest month that actually has spend data, not the calendar month —
  // statements lag, so the calendar month is usually empty.
  const latest = db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS m FROM v_transactions
       WHERE ${SPEND_WHERE}
       ORDER BY m DESC LIMIT 1`
    )
    .get() as { m: string } | undefined;
  const currentMonth =
    latest?.m ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  return db
    .prepare(
      `SELECT
         g.category,
         g.monthly_limit,
         COALESCE(SUM(v.amount), 0) AS spent,
         g.monthly_limit - COALESCE(SUM(v.amount), 0) AS remaining,
         CASE WHEN g.monthly_limit > 0
           THEN ROUND(COALESCE(SUM(v.amount), 0) / g.monthly_limit * 100, 1)
           ELSE 0
         END AS percentage
       FROM spending_goals g
       LEFT JOIN v_transactions v
         ON v.effective_category = g.category
         AND v.flow = 'spend'
         AND v.account_kind = 'card'
         AND substr(v.txn_date, 1, 7) = @month
       WHERE g.active = 1
       GROUP BY g.category, g.monthly_limit
       ORDER BY g.category`
    )
    .all({ month: currentMonth }) as GoalProgress[];
}
