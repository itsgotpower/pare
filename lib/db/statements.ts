import { getDb } from "../db";

export interface StatementRow {
  id: number;
  filename: string;
  source: string;
  account: string;
  period: string;
  uploaded_at: string;
  row_count: number;
}

export function insertStatement(stmt: {
  filename: string;
  source: string;
  account: string;
  period: string;
  row_count: number;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO statements (filename, source, account, period, row_count)
       VALUES (@filename, @source, @account, @period, @row_count)`
    )
    .run(stmt);
  return Number(result.lastInsertRowid);
}

export function listStatements(): StatementRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM statements ORDER BY uploaded_at DESC")
    .all() as StatementRow[];
}
