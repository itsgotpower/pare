-- Tags + reimbursement tracking (lib/db/tags.ts). Both tables are ROW-SCOPED
-- children of transactions (FK, no ON DELETE CASCADE — SQLite here never uses
-- it), so every delete path must clear them first (deleteStatement,
-- deleteManualTransaction, deleteImport, the /api/data WIPE) and they die with
-- their transactions on wipe — correct, unlike rules/goals/marks which survive.
--
-- Tags are orthogonal to categories: free-form labels ('vacation',
-- 'work-reimbursable') stored lowercase-trimmed + deduped (enforced in
-- lib/db/tags.ts, displayed uppercase). The composite PK gives the
-- per-transaction lookup its index; idx_txn_tags_tag serves the tag-filter join
-- on the transactions list.
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_txn_tags_tag ON transaction_tags(tag);

-- Reimbursement lifecycle: mark a spend row reimbursable (status 'outstanding'),
-- later mark it 'reimbursed' (or clear the mark entirely). One row per
-- transaction — the PK is the transaction id.
CREATE TABLE IF NOT EXISTS reimbursements (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id),
  status TEXT NOT NULL CHECK (status IN ('outstanding','reimbursed')),
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  reimbursed_at TEXT
);
