import { createHash, randomUUID } from "crypto";
import { getDb } from "../db";
import { sourceToKind } from "./account-kinds";
import { categorizeByRules, listRules, addOverride } from "./categories";

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

// Dedup key for an OFX/QFX import, seeded from the bank-assigned FITID (stable and
// unique per account). Namespacing by `source` (which encodes the account) keeps
// two accounts' identical FITIDs distinct and prevents collision with the
// positional PDF key above, so re-importing an overlapping OFX file is a no-op
// instead of a silent duplicate. Callers fall back to computeDedupKey() when a
// row has no FITID.
export function computeOfxDedupKey(source: string, fitId: string): string {
  return createHash("sha256").update(`ofx|${source}|${fitId}`).digest("hex");
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
  return insertManyTransactions([tx]).inserted > 0;
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

// A cash purchase recorded in-app — no statement behind it, so no natural dedup
// identity either. Amounts are dollars, positive = money spent (matching card
// spend rows).
export interface ManualTransactionInput {
  txn_date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  category: string; // the user's explicit pick
}

export const MANUAL_SOURCE = "manual";

/**
 * Insert a manually recorded cash transaction. Unlike statement rows there is
 * nothing to dedup against — submitting the same coffee twice on one day is two
 * real purchases — so the dedup_key is a random UUID under a `manual|` prefix
 * (uniqueness only, never collision-matched by a re-upload).
 *
 * The row's stored category is what the rules engine would say; the user's pick
 * is recorded as a category_override when it differs. That reuses the exact
 * mechanism recategorizeAll() already skips, so a later statement upload's
 * recategorize pass can never clobber an explicit choice.
 */
export function insertManualTransaction(input: ManualTransactionInput): { id: number } {
  const db = getDb();
  const ruleCategory = categorizeByRules(input.description, listRules());

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO transactions
           (statement_id, source, account, period, txn_date, description, amount, category, flow, dedup_key, account_kind)
         VALUES (NULL, @source, 'cash', @period, @txn_date, @description, @amount, @category, 'spend', @dedup_key, @account_kind)`
      )
      .run({
        source: MANUAL_SOURCE,
        period: input.txn_date.slice(0, 7),
        txn_date: input.txn_date,
        description: input.description,
        amount: input.amount,
        category: ruleCategory,
        dedup_key: `manual|${randomUUID()}`,
        account_kind: sourceToKind(MANUAL_SOURCE),
      });
    const id = Number(result.lastInsertRowid);
    if (input.category !== ruleCategory) addOverride(id, ruleCategory, input.category);
    return id;
  });

  return { id: tx() };
}

/**
 * Delete a manually recorded transaction. Statement-backed rows are refused —
 * removing those would silently un-reconcile a statement; the DANGER ZONE wipe
 * is the only path that deletes parsed data.
 */
export function deleteManualTransaction(id: number): { deleted: number } {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT source FROM transactions WHERE id = ?").get(id) as
      | { source: string }
      | undefined;
    if (!row || row.source !== MANUAL_SOURCE) return 0;
    // Override first — it carries a FK to transactions(id).
    db.prepare("DELETE FROM category_overrides WHERE transaction_id = ?").run(id);
    return db.prepare("DELETE FROM transactions WHERE id = ?").run(id).changes;
  });
  return { deleted: tx() };
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

// Every source that actually has rows — the source filter's option list.
// Derived (not hardcoded) so new banks/OFX imports show up automatically.
export function getSources(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT source FROM transactions ORDER BY source")
    .all() as { source: string }[];
  return rows.map((r) => r.source);
}
