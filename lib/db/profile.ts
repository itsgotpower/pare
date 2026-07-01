import fs from "fs";
import { getDb, DB_PATH } from "@/lib/db";

export interface SourceHealth {
  source: string;
  label: string;
  statement_count: number;
  last_period: string | null; // YYYY-MM of the newest statement
  last_txn_date: string | null;
  days_since_last: number | null; // days since last_txn_date (0 if in the future)
  coverage: boolean[]; // oldest→newest, one entry per month in coverage_window
}

export interface DataHealth {
  transactions: number;
  statements: number;
  coverage_months: number; // distinct months with any transaction
  db_bytes: number;
  first_date: string | null;
  last_date: string | null;
  categorized_pct: number; // 0–100, share of txns not 'Other / uncategorized'
  rule_count: number;
  coverage_window: string[]; // last 12 data months, oldest→newest (YYYY-MM)
  sources: SourceHealth[];
}

// Only the labels that differ from the derived `<bank>_<kind>` form below.
const SOURCE_LABELS: Record<string, string> = {
  cibc_chequing: "CHEQUING",
  wealthsimple_cash: "WS CASH",
  wealthsimple_savings: "WS SAVINGS",
};

// Human label for a parser `source`. Explicit overrides win; otherwise derive a
// readable label from the `<bank>_<kind>` convention (rbc_chequing → "RBC
// CHEQUING") so a newly-added bank renders sensibly without a map entry.
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").toUpperCase();
}

// Days without a new transaction before a source is flagged as stale.
// Statements are monthly, so ~a cycle plus mailing slack.
export const STALE_AFTER_DAYS = 40;

function lastNMonths(endMonth: string, n: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

export function getDataHealth(): DataHealth {
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS transactions,
              MIN(txn_date) AS first_date,
              MAX(txn_date) AS last_date,
              COUNT(DISTINCT substr(txn_date, 1, 7)) AS coverage_months
       FROM transactions`
    )
    .get() as {
    transactions: number;
    first_date: string | null;
    last_date: string | null;
    coverage_months: number;
  };

  const statementCount = (
    db.prepare("SELECT COUNT(*) AS n FROM statements").get() as { n: number }
  ).n;

  const ruleCount = (
    db.prepare("SELECT COUNT(*) AS n FROM category_rules").get() as { n: number }
  ).n;

  const uncategorized = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM v_transactions WHERE effective_category = 'Other / uncategorized'"
      )
      .get() as { n: number }
  ).n;

  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(DB_PATH).size;
  } catch {
    // size stays 0 if the file is somehow unreadable
  }

  const endMonth = totals.last_date?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
  const window = lastNMonths(endMonth, 12);
  const windowSet = new Set(window);

  const perSource = db
    .prepare(
      `SELECT source,
              MAX(txn_date) AS last_txn_date,
              COUNT(DISTINCT substr(txn_date, 1, 7)) AS month_count
       FROM transactions
       GROUP BY source`
    )
    .all() as { source: string; last_txn_date: string; month_count: number }[];

  const stmtBySource = new Map(
    (
      db
        .prepare(
          "SELECT source, COUNT(*) AS n, MAX(period) AS last_period FROM statements GROUP BY source"
        )
        .all() as { source: string; n: number; last_period: string | null }[]
    ).map((r) => [r.source, r])
  );

  const monthsBySource = new Map<string, Set<string>>();
  for (const row of db
    .prepare(
      "SELECT DISTINCT source, substr(txn_date, 1, 7) AS month FROM transactions"
    )
    .all() as { source: string; month: string }[]) {
    if (!windowSet.has(row.month)) continue;
    if (!monthsBySource.has(row.source)) monthsBySource.set(row.source, new Set());
    monthsBySource.get(row.source)!.add(row.month);
  }

  const today = new Date().toISOString().slice(0, 10);
  const sources: SourceHealth[] = perSource
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((row) => {
      const stmt = stmtBySource.get(row.source);
      const covered = monthsBySource.get(row.source) ?? new Set<string>();
      const daysSince = Math.max(
        0,
        Math.round(
          (Date.parse(today) - Date.parse(row.last_txn_date)) / 86_400_000
        )
      );
      return {
        source: row.source,
        label: sourceLabel(row.source),
        statement_count: stmt?.n ?? 0,
        last_period: stmt?.last_period ?? null,
        last_txn_date: row.last_txn_date,
        days_since_last: daysSince,
        coverage: window.map((m) => covered.has(m)),
      };
    });

  const categorizedPct =
    totals.transactions === 0
      ? 100
      : Math.round(((totals.transactions - uncategorized) / totals.transactions) * 1000) / 10;

  return {
    transactions: totals.transactions,
    statements: statementCount,
    coverage_months: totals.coverage_months,
    db_bytes: dbBytes,
    first_date: totals.first_date,
    last_date: totals.last_date,
    categorized_pct: categorizedPct,
    rule_count: ruleCount,
    coverage_window: window,
    sources,
  };
}
