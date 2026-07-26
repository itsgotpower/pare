import { getDb } from "../db";

// Tags + reimbursement tracking (migration 013). Tags are ORTHOGONAL to
// categories: free-form labels ('vacation', 'work-reimbursable') a transaction
// can carry any number of, stored lowercase-trimmed and deduped (display is
// uppercase, brutalist-style — a UI concern). Reimbursements are a per-row
// lifecycle: mark a spend row reimbursable ('outstanding'), later mark it
// 'reimbursed', or clear the mark.
//
// Both tables are row-scoped children of transactions (FK, no ON DELETE
// CASCADE), so every transaction-delete path clears them first — see
// deleteStatement / deleteManualTransaction / deleteImport and the /api/data
// WIPE — and they die with their transactions on wipe (correct: row-scoped,
// unlike rules/goals which survive).
//
// Read surfaces follow the house split: display reads (listTags,
// reimbursementSummary, listReimbursements) join v_transactions so the
// hidden-account filter (migration 009) applies in one place; export reads
// (listAllTags, listAllReimbursements) read the BASE table so hidden accounts
// are never dropped from a backup.

export interface TagCount {
  tag: string;
  count: number;
}

// One (transaction, tag) pair — the flat JSON-export shape.
export interface TagRow {
  transaction_id: number;
  tag: string;
}

export type ReimbursementStatus = "outstanding" | "reimbursed";

export interface ReimbursementRow {
  transaction_id: number;
  status: ReimbursementStatus;
  marked_at: string;
  reimbursed_at: string | null;
}

// A reimbursement joined with its transaction — the tracking-list shape.
export interface ReimbursementListRow extends ReimbursementRow {
  txn_date: string;
  description: string;
  amount: number;
}

export interface ReimbursementSummary {
  outstanding: { count: number; total: number };
  reimbursed: { count: number; total: number };
}

const MAX_TAGS_PER_TRANSACTION = 20;
const MAX_TAG_LENGTH = 40;

function requireTransaction(transactionId: number): { flow: string } {
  const row = getDb()
    .prepare("SELECT flow FROM transactions WHERE id = ?")
    .get(transactionId) as { flow: string } | undefined;
  if (!row) throw new Error("transaction not found");
  return row;
}

/** A transaction's tags, alphabetical. Empty array for an untagged/unknown id. */
export function tagsFor(transactionId: number): string[] {
  const rows = getDb()
    .prepare("SELECT tag FROM transaction_tags WHERE transaction_id = ? ORDER BY tag")
    .all(transactionId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/**
 * Atomically replace a transaction's tag set. Tags are normalized to
 * lowercase-trimmed; empties are dropped and duplicates collapse (so
 * [" Vacation", "vacation"] stores one 'vacation'). An empty list clears all
 * tags. Throws (user-safe messages) on an unknown transaction id, a non-string
 * tag, or a tag over the length/count caps. Returns the stored, normalized set.
 */
export function setTags(transactionId: number, tags: string[]): string[] {
  const db = getDb();
  requireTransaction(transactionId);
  if (!Array.isArray(tags)) throw new Error("tags must be an array");

  const normalized: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") throw new Error("Every tag must be a string");
    const tag = raw.trim().toLowerCase();
    if (!tag) continue; // input artifact, not an error
    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(`Tags are capped at ${MAX_TAG_LENGTH} characters`);
    }
    if (!normalized.includes(tag)) normalized.push(tag);
  }
  if (normalized.length > MAX_TAGS_PER_TRANSACTION) {
    throw new Error(`A transaction can carry at most ${MAX_TAGS_PER_TRANSACTION} tags`);
  }
  normalized.sort();

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM transaction_tags WHERE transaction_id = ?").run(transactionId);
    const insert = db.prepare(
      "INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?)"
    );
    for (const tag of normalized) insert.run(transactionId, tag);
  });
  tx();
  return normalized;
}

/**
 * Distinct tags with how many (visible) transactions carry each — the filter
 * dropdown's option list. Joined through v_transactions so hidden accounts are
 * excluded in the one place that rule lives (migration 009).
 */
export function listTags(): TagCount[] {
  return getDb()
    .prepare(
      `SELECT tt.tag, COUNT(*) AS count
       FROM transaction_tags tt
       JOIN v_transactions v ON v.id = tt.transaction_id
       GROUP BY tt.tag ORDER BY tt.tag`
    )
    .all() as TagCount[];
}

/** Every (transaction, tag) pair, BASE table — the JSON-export read. */
export function listAllTags(): TagRow[] {
  return getDb()
    .prepare(
      "SELECT transaction_id, tag FROM transaction_tags ORDER BY transaction_id, tag"
    )
    .all() as TagRow[];
}

// --- Reimbursements ---------------------------------------------------------

/**
 * Mark a spend transaction as awaiting reimbursement. Upsert: re-marking a
 * 'reimbursed' row reopens it as 'outstanding' (clearing reimbursed_at, keeping
 * the original marked_at); re-marking an already-outstanding row is a no-op.
 * Only spend rows qualify (income/payments/transfers aren't reimbursable —
 * same v1 scoping as splits).
 */
export function markReimbursable(transactionId: number): void {
  const row = requireTransaction(transactionId);
  if (row.flow !== "spend") {
    throw new Error("Only spend transactions can be marked reimbursable");
  }
  getDb()
    .prepare(
      `INSERT INTO reimbursements (transaction_id, status) VALUES (?, 'outstanding')
       ON CONFLICT(transaction_id) DO UPDATE SET status = 'outstanding', reimbursed_at = NULL`
    )
    .run(transactionId);
}

/** Close the loop: an outstanding reimbursement came in. */
export function markReimbursed(transactionId: number): void {
  requireTransaction(transactionId);
  const changed = getDb()
    .prepare(
      `UPDATE reimbursements
       SET status = 'reimbursed', reimbursed_at = datetime('now')
       WHERE transaction_id = ?`
    )
    .run(transactionId).changes;
  if (!changed) throw new Error("transaction is not marked as reimbursable");
}

/** Remove the reimbursement mark entirely (idempotent, like clearSplits). */
export function clearReimbursement(transactionId: number): void {
  getDb().prepare("DELETE FROM reimbursements WHERE transaction_id = ?").run(transactionId);
}

/** One row's reimbursement state, or null when unmarked. */
export function reimbursementFor(transactionId: number): ReimbursementRow | null {
  const row = getDb()
    .prepare(
      `SELECT transaction_id, status, marked_at, reimbursed_at
       FROM reimbursements WHERE transaction_id = ?`
    )
    .get(transactionId) as ReimbursementRow | undefined;
  return row ?? null;
}

/**
 * Outstanding vs reimbursed counts + dollar totals (of the parent transaction
 * amounts) — the "N OUTSTANDING · $X" strip. Visible accounts only (see the
 * module header).
 */
export function reimbursementSummary(): ReimbursementSummary {
  const rows = getDb()
    .prepare(
      `SELECT r.status, COUNT(*) AS count, COALESCE(SUM(v.amount), 0) AS total
       FROM reimbursements r
       JOIN v_transactions v ON v.id = r.transaction_id
       GROUP BY r.status`
    )
    .all() as { status: ReimbursementStatus; count: number; total: number }[];

  const summary: ReimbursementSummary = {
    outstanding: { count: 0, total: 0 },
    reimbursed: { count: 0, total: 0 },
  };
  for (const row of rows) {
    summary[row.status] = { count: row.count, total: row.total };
  }
  return summary;
}

/**
 * Every marked transaction joined with its date/description/amount — the
 * tracking list. Outstanding first, then newest transaction first within each
 * status. Visible accounts only.
 */
export function listReimbursements(): ReimbursementListRow[] {
  return getDb()
    .prepare(
      `SELECT r.transaction_id, r.status, r.marked_at, r.reimbursed_at,
              v.txn_date, v.description, v.amount
       FROM reimbursements r
       JOIN v_transactions v ON v.id = r.transaction_id
       ORDER BY CASE r.status WHEN 'outstanding' THEN 0 ELSE 1 END,
                v.txn_date DESC, r.transaction_id DESC`
    )
    .all() as ReimbursementListRow[];
}

/** Every reimbursement row, BASE table — the JSON-export read. */
export function listAllReimbursements(): ReimbursementRow[] {
  return getDb()
    .prepare(
      `SELECT transaction_id, status, marked_at, reimbursed_at
       FROM reimbursements ORDER BY transaction_id`
    )
    .all() as ReimbursementRow[];
}
