import { getDb } from "../db";
import { SPEND_WHERE } from "./account-kinds";

export interface DailySpend {
  date: string; // YYYY-MM-DD
  total: number;
  count: number;
}

// Daily totals for the calendar heatmap. Same universe as the spend charts:
// flow='spend' from card accounts only — transfers, fees, payments and
// chequing rows excluded.
export function getDailySpend(): DailySpend[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT txn_date AS date, SUM(amount) AS total, COUNT(*) AS count
       FROM v_transactions
       WHERE ${SPEND_WHERE}
       GROUP BY txn_date ORDER BY txn_date`
    )
    .all() as DailySpend[];
}
