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

/**
 * Delete a statement and every transaction parsed from it (plus each of those
 * rows' category overrides and splits). Unlike deleteManualTransaction — which
 * refuses statement-backed rows — this is the deliberate path for removing a
 * whole mis-parsed statement (e.g. one whose dates landed in the wrong year).
 * Returns 0/1 for the statement and the number of transactions removed. Rules,
 * goals, and manual/imported rows (statement_id NULL) are untouched.
 */
export function deleteStatement(id: number): { deleted: number; transactions: number } {
  const db = getDb();
  const tx = db.transaction(() => {
    const stmt = db.prepare("SELECT id FROM statements WHERE id = ?").get(id) as
      | { id: number }
      | undefined;
    if (!stmt) return { deleted: 0, transactions: 0 };
    // Children first — overrides and splits both carry a FK to transactions(id),
    // and transactions carry a FK to statements(id) (no ON DELETE CASCADE).
    db.prepare(
      "DELETE FROM category_overrides WHERE transaction_id IN (SELECT id FROM transactions WHERE statement_id = ?)"
    ).run(id);
    db.prepare(
      "DELETE FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE statement_id = ?)"
    ).run(id);
    const transactions = db
      .prepare("DELETE FROM transactions WHERE statement_id = ?")
      .run(id).changes;
    const deleted = db.prepare("DELETE FROM statements WHERE id = ?").run(id).changes;
    return { deleted, transactions };
  });
  return tx();
}
