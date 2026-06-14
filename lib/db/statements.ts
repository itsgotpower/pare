import { getDb } from "../db";

export interface StatementRow {
  id: number;
  filename: string;
  source: string;
  account: string;
  period: string;
  uploaded_at: string;
  row_count: number;
  closing_balance: number | null;
  closing_date: string | null;
}

export function insertStatement(stmt: {
  filename: string;
  source: string;
  account: string;
  period: string;
  row_count: number;
  closing_balance?: number | null;
  closing_date?: string | null;
  account_kind?: string;
}): number {
  const db = getDb();
  // Upsert so re-uploading a statement backfills the balance fields
  // (transactions stay deduped by their own keys). account_kind is set on first
  // insert and left untouched on conflict — a statement's source never changes.
  const row = db
    .prepare(
      `INSERT INTO statements (filename, source, account, period, row_count, closing_balance, closing_date, account_kind)
       VALUES (@filename, @source, @account, @period, @row_count, @closing_balance, @closing_date, @account_kind)
       ON CONFLICT(filename) DO UPDATE SET
         row_count = excluded.row_count,
         closing_balance = COALESCE(excluded.closing_balance, statements.closing_balance),
         closing_date = COALESCE(excluded.closing_date, statements.closing_date)
       RETURNING id`
    )
    .get({
      ...stmt,
      closing_balance: stmt.closing_balance ?? null,
      closing_date: stmt.closing_date ?? null,
      account_kind: stmt.account_kind ?? "unknown",
    }) as { id: number };
  return row.id;
}

export function listStatements(): StatementRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM statements ORDER BY uploaded_at DESC")
    .all() as StatementRow[];
}
