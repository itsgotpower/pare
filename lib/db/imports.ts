import { getDb } from "../db";

// Provenance + rollback for migrated history. Each import gets one `imports` row
// (migration 006) and its transactions carry that row's id in
// transactions.import_id, so a botched migration is one DELETE away. The
// per-account import WATERMARK is DERIVED (MAX(txn_date) grouped by source+kind)
// rather than stored, so it stays correct even after a partial undo.

export interface ImportRow {
  id: number;
  provider: string;
  imported_at: string;
  row_count: number;
  account_map: string | null; // JSON {foreignAccount: {source, account_kind}}
  date_min: string | null;
  date_max: string | null;
}

export interface ImportWatermark {
  source: string;
  account_kind: string;
  date_max: string;
}

export interface ImportedWindowRow {
  txn_date: string;
  description: string;
  amount: number;
}

export function createImport(rec: {
  provider: string;
  row_count: number;
  account_map: string;
  date_min: string | null;
  date_max: string | null;
}): number {
  const db = getDb();
  const row = db
    .prepare(
      `INSERT INTO imports (provider, row_count, account_map, date_min, date_max)
       VALUES (@provider, @row_count, @account_map, @date_min, @date_max)
       RETURNING id`
    )
    .get(rec) as { id: number };
  return row.id;
}

export function listImports(): ImportRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM imports ORDER BY imported_at DESC, id DESC")
    .all() as ImportRow[];
}

// One-click undo. Deletes the import's transactions FIRST (transactions.import_id
// is an FK -> imports.id; the parent can't go while children reference it — same
// "children first" ordering as the /api/data wipe), then the imports row, in one
// transaction. Returns how many transactions were removed.
export function deleteImport(id: number): { deleted: number } {
  const db = getDb();
  let deleted = 0;
  const tx = db.transaction(() => {
    // transaction_splits FK -> transactions(id): clear an imported row's splits
    // before the row, or the DELETE below throws (the user can split any spend
    // row, including an imported one). Same "children first" rule as the WIPE
    // and deleteManualTransaction paths.
    db.prepare(
      "DELETE FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE import_id = ?)"
    ).run(id);
    deleted = db.prepare("DELETE FROM transactions WHERE import_id = ?").run(id).changes;
    db.prepare("DELETE FROM imports WHERE id = ?").run(id);
  });
  tx();
  return { deleted };
}

// Per-(source, account_kind) latest imported txn date — the overlap-guard
// watermark. Empty when nothing has been imported (the guard's fast path).
export function getImportWatermarks(): ImportWatermark[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT source, account_kind, MAX(txn_date) AS date_max
       FROM transactions
       WHERE import_id IS NOT NULL
       GROUP BY source, account_kind`
    )
    .all() as ImportWatermark[];
}

// Imported rows of a given kind within [fromDate, toDate] — the windowed
// prefetch the overlap guard buckets by amount (one query, not N). The
// idx_transactions_import_id index keeps the import_id filter cheap.
export function getImportedRowsInWindow(
  accountKind: string,
  fromDate: string,
  toDate: string
): ImportedWindowRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT txn_date, description, amount
       FROM transactions
       WHERE import_id IS NOT NULL
         AND account_kind = @kind
         AND txn_date >= @from AND txn_date <= @to`
    )
    .all({ kind: accountKind, from: fromDate, to: toDate }) as ImportedWindowRow[];
}
