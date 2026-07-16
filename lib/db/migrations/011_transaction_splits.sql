-- Split transactions: one spend row divided into >= 2 category parts that sum
-- to the parent amount (enforced in lib/db/splits.ts, not by the schema). Parts
-- reference transactions(id), so they are WIPED with transactions by the
-- /api/data DANGER ZONE wipe (splits deleted before transactions — FK ordering,
-- same as category_overrides) and deleted alongside a manual row's removal.
CREATE TABLE IF NOT EXISTS transaction_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_splits_txn ON transaction_splits(transaction_id);

-- v_category_slices: the CATEGORY-AGGREGATION surface. v_transactions stays the
-- row-identity surface (one row per transaction — lists, pagination, exports);
-- this view emits one row per split part for transactions that have splits, and
-- one whole-transaction row for everything else, so SUM(amount) over any
-- filtered universe equals the same SUM over v_transactions (slices must total
-- identically to parents — cashflow MONEY OUT and month-review reconciliation
-- depend on it). Column names effective_category / flow / account_kind are
-- load-bearing: the shared SPEND_WHERE / OUTFLOW_WHERE fragments interpolate
-- unchanged. Built ON v_transactions so the whole-row branch inherits the
-- override COALESCE and BOTH branches inherit the hidden-account filter
-- (migration 009) from one place.
CREATE VIEW IF NOT EXISTS v_category_slices AS
SELECT
    v.id AS transaction_id,
    v.txn_date,
    v.description,
    v.source,
    v.account_kind,
    v.flow,
    v.amount,
    v.effective_category
FROM v_transactions v
WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = v.id)
UNION ALL
SELECT
    v.id AS transaction_id,
    v.txn_date,
    v.description,
    v.source,
    v.account_kind,
    v.flow,
    s.amount,
    s.category AS effective_category
FROM v_transactions v
JOIN transaction_splits s ON s.transaction_id = v.id;
