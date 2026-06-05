import { getDb } from "../db";

export interface BaselineMonth {
  month: string;
  total: number;
  baseline: number;
}

export interface OneOff {
  txn_date: string;
  description: string;
  amount: number;
  category: string;
}

export interface BaselineResult {
  threshold: number;
  monthly: BaselineMonth[];
  oneoffs: OneOff[];
}

// "Discretionary baseline" = card spend excluding large one-off charges (a single
// transaction at or above `threshold`). Big travel/one-time purchases otherwise
// skew the monthly/category averages; the baseline is the runway-planning number.
// Only flow='spend' from amex/cibc_visa, consistent with the spend charts.
export function getBaseline(threshold: number = 300): BaselineResult {
  const db = getDb();

  const monthly = db
    .prepare(
      `SELECT substr(txn_date, 1, 7) AS month,
              SUM(amount) AS total,
              SUM(CASE WHEN amount < @threshold THEN amount ELSE 0 END) AS baseline
       FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
       GROUP BY month
       ORDER BY month`
    )
    .all({ threshold }) as BaselineMonth[];

  const oneoffs = db
    .prepare(
      `SELECT txn_date, description, amount, effective_category AS category
       FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
         AND amount >= @threshold
       ORDER BY amount DESC`
    )
    .all({ threshold }) as OneOff[];

  return { threshold, monthly, oneoffs };
}
