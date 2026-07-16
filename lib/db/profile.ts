import fs from "fs";
import { getDb, DB_PATH } from "@/lib/db";
import { getAccountMetaMap, sourceLabel } from "./accounts";

export interface SourceHealth {
  source: string;
  label: string; // nickname if set, else derived from the source string
  nickname: string | null;
  hidden: boolean; // excluded from charts (data health always shows it)
  closed: boolean; // history kept; staleness nudges suppressed
  statement_count: number;
  last_period: string | null; // YYYY-MM of the newest statement
  last_txn_date: string | null;
  days_since_last: number | null; // days since last_txn_date (0 if in the future)
  coverage: boolean[]; // oldest→newest, one entry per month in coverage_window
  // Months (YYYY-MM) with NO data for this source, from its first month through
  // the last COMPLETE calendar month — i.e. gaps in statement coverage relative
  // to today. Excludes the current month (its statement usually isn't issued
  // yet, so flagging it would be perpetual noise). Empty for manual/cash rows.
  missing_months: string[];
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

// Inclusive list of YYYY-MM months from `start` to `end`. Empty if start > end.
function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
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

  // Base table + override join, NOT v_transactions: the view excludes hidden
  // accounts (migration 009) but the totals above count every row, so the view
  // would overstate categorized_pct whenever a hidden account has stragglers.
  const uncategorized = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM transactions t
         LEFT JOIN category_overrides co ON co.transaction_id = t.id
         WHERE COALESCE(co.new_category, t.category) = 'Other / uncategorized'`
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

  // `period` is the raw statement string as printed on the PDF ("May 1 to
  // May 31, 2026") — not sortable and not YYYY-MM. `closing_date` (ISO, from
  // migration 004) is; MAX() skips NULLs so pre-004 rows just fall back to "—".
  const stmtBySource = new Map(
    (
      db
        .prepare(
          "SELECT source, COUNT(*) AS n, MAX(closing_date) AS last_close FROM statements GROUP BY source"
        )
        .all() as { source: string; n: number; last_close: string | null }[]
    ).map((r) => [r.source, r])
  );

  // Two views of each source's months: `monthsBySource` is windowed (drives the
  // 12-dot coverage strip); `allMonthsBySource` is the full history (drives
  // missing-month gap detection, which spans the source's whole lifetime).
  const monthsBySource = new Map<string, Set<string>>();
  const allMonthsBySource = new Map<string, Set<string>>();
  for (const row of db
    .prepare(
      "SELECT DISTINCT source, substr(txn_date, 1, 7) AS month FROM transactions"
    )
    .all() as { source: string; month: string }[]) {
    if (!allMonthsBySource.has(row.source)) allMonthsBySource.set(row.source, new Set());
    allMonthsBySource.get(row.source)!.add(row.month);
    if (!windowSet.has(row.month)) continue;
    if (!monthsBySource.has(row.source)) monthsBySource.set(row.source, new Set());
    monthsBySource.get(row.source)!.add(row.month);
  }

  // The last COMPLETE calendar month — the newest month a statement should
  // realistically exist for. Gaps are measured up to here, not the current month.
  const now = new Date();
  const prevM = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastCompleteMonth = `${prevM.getUTCFullYear()}-${String(prevM.getUTCMonth() + 1).padStart(2, "0")}`;

  const accountMeta = getAccountMetaMap();

  const today = new Date().toISOString().slice(0, 10);
  const sources: SourceHealth[] = perSource
    .sort((a, b) => a.source.localeCompare(b.source))
    .map((row) => {
      const stmt = stmtBySource.get(row.source);
      const covered = monthsBySource.get(row.source) ?? new Set<string>();
      const meta = accountMeta.get(row.source);
      const daysSince = Math.max(
        0,
        Math.round(
          (Date.parse(today) - Date.parse(row.last_txn_date)) / 86_400_000
        )
      );
      // Gap detection: every month from this source's first month through the
      // last complete month that has no data. Manual/cash rows aren't a monthly
      // statement feed, so they're never "missing" anything.
      const allMonths = allMonthsBySource.get(row.source) ?? new Set<string>();
      const firstMonth = [...allMonths].sort()[0];
      const missing =
        row.source === "manual" || !firstMonth
          ? []
          : monthsBetween(firstMonth, lastCompleteMonth).filter(
              (m) => !allMonths.has(m)
            );
      return {
        source: row.source,
        label: meta?.nickname?.trim() || sourceLabel(row.source),
        nickname: meta?.nickname ?? null,
        hidden: meta?.hidden ?? false,
        closed: meta?.closed ?? false,
        statement_count: stmt?.n ?? 0,
        last_period: stmt?.last_close?.slice(0, 7) ?? null,
        last_txn_date: row.last_txn_date,
        days_since_last: daysSince,
        coverage: window.map((m) => covered.has(m)),
        missing_months: missing,
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
