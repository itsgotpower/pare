import { createHash } from "crypto";
import { getDb } from "../db";

export interface TransactionRow {
  id: number;
  statement_id: number | null;
  source: string;
  account: string;
  period: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  flow: string;
  effective_category: string;
  has_override: number;
  dedup_key: string;
  created_at: string;
}

export interface TransactionFilters {
  category?: string;
  source?: string;
  flow?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function computeDedupKey(
  source: string,
  txnDate: string,
  description: string,
  amount: number,
  seq: number
): string {
  const raw = `${source}|${txnDate}|${description}|${amount}|${seq}`;
  return createHash("sha256").update(raw).digest("hex");
}

export function insertTransaction(tx: {
  statement_id: number | null;
  source: string;
  account: string;
  period: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  flow: string;
  dedup_key: string;
  account_kind?: string;
  import_id?: number | null;
}): boolean {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key, account_kind, import_id)
    VALUES
      (@statement_id, @source, @account, @period, @txn_date, @description, @amount, @category, @flow, @dedup_key, @account_kind, @import_id)
  `);
  const result = stmt.run({
    ...tx,
    account_kind: tx.account_kind ?? "unknown",
    import_id: tx.import_id ?? null,
  });
  return result.changes > 0;
}

export function insertManyTransactions(
  txs: {
    statement_id: number | null;
    source: string;
    account: string;
    period: string;
    txn_date: string;
    description: string;
    amount: number;
    category: string;
    flow: string;
    dedup_key: string;
    account_kind?: string;
    import_id?: number | null;
  }[]
): { inserted: number; skipped: number } {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key, account_kind, import_id)
    VALUES
      (@statement_id, @source, @account, @period, @txn_date, @description, @amount, @category, @flow, @dedup_key, @account_kind, @import_id)
  `);

  let inserted = 0;
  const run = db.transaction((rows: typeof txs) => {
    for (const row of rows) {
      const bound = {
        ...row,
        account_kind: row.account_kind ?? "unknown",
        import_id: row.import_id ?? null,
      };
      if (stmt.run(bound).changes > 0) inserted++;
    }
  });
  run(txs);

  return { inserted, skipped: txs.length - inserted };
}

export function getTransactionCategory(id: number): { category: string } | null {
  const db = getDb();
  const row = db
    .prepare("SELECT category FROM transactions WHERE id = ?")
    .get(id) as { category: string } | undefined;
  return row ?? null;
}

export function listTransactions(filters: TransactionFilters = {}): {
  rows: TransactionRow[];
  total: number;
} {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (filters.category) {
    conditions.push("effective_category = @category");
    params.category = filters.category;
  }
  if (filters.source) {
    conditions.push("source = @source");
    params.source = filters.source;
  }
  if (filters.flow) {
    conditions.push("flow = @flow");
    params.flow = filters.flow;
  }
  if (filters.from) {
    conditions.push("txn_date >= @from");
    params.from = filters.from;
  }
  if (filters.to) {
    conditions.push("txn_date <= @to");
    params.to = filters.to;
  }
  if (filters.search) {
    conditions.push("description LIKE @search");
    params.search = `%${filters.search}%`;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 50;
  const offset = ((filters.page || 1) - 1) * limit;

  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM v_transactions ${where}`).get(params) as {
      count: number;
    }
  ).count;

  const rows = db
    .prepare(
      `SELECT *,
         EXISTS(SELECT 1 FROM category_overrides co WHERE co.transaction_id = v_transactions.id) AS has_override
       FROM v_transactions ${where} ORDER BY txn_date DESC, id DESC LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as TransactionRow[];

  return { rows, total };
}

export function getCategories(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT DISTINCT effective_category FROM v_transactions WHERE flow = 'spend' ORDER BY effective_category"
    )
    .all() as { effective_category: string }[];
  return rows.map((r) => r.effective_category);
}
