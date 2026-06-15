import { getDb } from "../db";
import { OUTFLOW_WHERE } from "./account-kinds";
import { TYPE_CASE } from "./income";

export interface CashflowIncome {
  type: string;
  total: number;
}

export interface CashflowExpense {
  category: string;
  total: number;
}

export interface Cashflow {
  months: string[]; // months with chequing/income data, ascending
  month: string | null; // selected month, null = whole period
  income: CashflowIncome[];
  expenses: CashflowExpense[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

// Same expense universe as getIncomeVsSpend (lib/db/income.ts): card spend,
// chequing debits/fees, and categorized chequing transfers (rent). Card
// payments are excluded to avoid double-counting. The shared, account_kind-keyed
// definition lives in account-kinds.ts so imported foreign accounts join in too.
const EXPENSE_WHERE = OUTFLOW_WHERE;

// Months that have chequing data — cashflow is only meaningful when both
// sides (income and spend) are present. Card-only months (e.g. before the
// first chequing statement) are excluded from the period.
const INCOME_MONTHS = `(SELECT DISTINCT substr(txn_date, 1, 7) FROM v_transactions WHERE flow = 'income')`;

// Money in by type → money out by category → net, for one month or the whole
// period with chequing data. Drives the CASHFLOW tab's Sankey.
export function getCashflow(month?: string): Cashflow {
  const db = getDb();

  const months = (
    db
      .prepare(
        `SELECT substr(txn_date, 1, 7) AS m FROM v_transactions
         WHERE flow = 'income' GROUP BY m ORDER BY m`
      )
      .all() as { m: string }[]
  ).map((r) => r.m);

  const selected = month && months.includes(month) ? month : null;
  const monthWhere = selected
    ? `AND substr(txn_date, 1, 7) = @month`
    : `AND substr(txn_date, 1, 7) IN ${INCOME_MONTHS}`;
  const params = selected ? { month: selected } : {};

  const income = db
    .prepare(
      `SELECT ${TYPE_CASE} AS type, SUM(amount) AS total
       FROM v_transactions
       WHERE flow = 'income' ${monthWhere}
       GROUP BY type ORDER BY total DESC`
    )
    .all(params) as CashflowIncome[];

  const expenses = db
    .prepare(
      `SELECT effective_category AS category, SUM(amount) AS total
       FROM v_transactions
       WHERE ${EXPENSE_WHERE} ${monthWhere}
       GROUP BY category ORDER BY total DESC`
    )
    .all(params) as CashflowExpense[];

  const totalIncome = income.reduce((s, i) => s + i.total, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);

  return {
    months,
    month: selected,
    income,
    expenses,
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
  };
}
