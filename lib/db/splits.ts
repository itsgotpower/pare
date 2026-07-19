import { getDb } from "../db";

// Split transactions: divide ONE spend row into >= 2 category parts that sum to
// the parent amount. Parts live in transaction_splits (migration 011) and are
// aggregated through the v_category_slices view — category charts count the
// parts, while amount-only aggregates (monthly totals, heatmap, baseline
// one-offs, subscription detection) keep reading the parent row, so a split
// $600 charge still counts as one $600 one-off.
//
// Precedence: splits SUPERSEDE overrides. setSplits deletes any
// category_overrides row for the transaction, and addOverride
// (lib/db/categories.ts) deletes any splits — the two are mutually exclusive in
// both directions so effective categorization is never ambiguous.
// recategorizeAll / recategorizeMatching skip split transactions the same way
// they skip overridden ones (a split is an explicit user choice).

export interface SplitRow {
  id: number;
  transaction_id: number;
  category: string;
  amount: number;
}

export interface SplitPart {
  category: string;
  amount: number;
}

export function getSplits(transactionId: number): SplitRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, transaction_id, category, amount
       FROM transaction_splits WHERE transaction_id = ? ORDER BY id`
    )
    .all(transactionId) as SplitRow[];
}

// Every split part across all transactions, for the JSON export/backup. Ordered
// so the export is stable and re-slices cleanly against the exported txns.
export function listAllSplits(): SplitRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, transaction_id, category, amount
       FROM transaction_splits ORDER BY transaction_id, id`
    )
    .all() as SplitRow[];
}

/**
 * Create or replace the split for one transaction. Validations (all throw an
 * Error with a user-safe message):
 *   - the transaction must exist and have flow='spend' (v1 scope — transfers,
 *     income, payments, fees can't be split);
 *   - at least 2 parts, each with a non-empty category and an amount > 0
 *     (rounded to cents);
 *   - the parts must sum to the parent amount within half a cent.
 *
 * Deletes any category_override for the transaction (splits supersede
 * overrides — see the module header) and replaces any existing split, all in
 * one DB transaction.
 */
export function setSplits(transactionId: number, parts: SplitPart[]): void {
  const db = getDb();

  const parent = db
    .prepare("SELECT amount, flow FROM transactions WHERE id = ?")
    .get(transactionId) as { amount: number; flow: string } | undefined;
  if (!parent) throw new Error("transaction not found");
  if (parent.flow !== "spend") {
    throw new Error("Only spend transactions can be split");
  }
  if (!Array.isArray(parts) || parts.length < 2) {
    throw new Error("A split needs at least 2 parts");
  }

  const cleaned = parts.map((p) => ({
    category: typeof p?.category === "string" ? p.category.trim() : "",
    // Cents precision — kills float dust before it hits the DB (same rounding
    // as the manual-cash insert path).
    amount: Math.round(Number(p?.amount) * 100) / 100,
  }));
  for (const p of cleaned) {
    if (!p.category) throw new Error("Every part needs a category");
    if (!Number.isFinite(p.amount) || p.amount <= 0) {
      throw new Error("Every part amount must be greater than zero");
    }
  }

  const sum = cleaned.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(sum - parent.amount) > 0.005) {
    throw new Error(
      `Parts must add up to the transaction amount (${parent.amount.toFixed(2)}, got ${sum.toFixed(2)})`
    );
  }

  const tx = db.transaction(() => {
    // Splits supersede overrides — mutual exclusion, both directions (the other
    // direction lives in addOverride, lib/db/categories.ts).
    db.prepare("DELETE FROM category_overrides WHERE transaction_id = ?").run(transactionId);
    db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").run(transactionId);
    const insert = db.prepare(
      "INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (?, ?, ?)"
    );
    for (const p of cleaned) insert.run(transactionId, p.category, p.amount);
  });
  tx();
}

/** Remove a transaction's split — it reverts to its base/override category. */
export function clearSplits(transactionId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM transaction_splits WHERE transaction_id = ?").run(transactionId);
}
