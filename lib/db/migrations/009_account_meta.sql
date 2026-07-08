-- Account management: per-source user metadata. Keyed by `source` (the same
-- key everything else uses), so it survives the /api/data WIPE like
-- rules/goals/marks — re-uploading statements for a source picks its meta back
-- up. nickname overrides the derived display label; hidden excludes the
-- account from every chart/total (but never from exports); closed keeps the
-- history in the charts but stops staleness nudges, net-worth carry-forward,
-- and forecast anchoring.
CREATE TABLE IF NOT EXISTS account_meta (
  source     TEXT PRIMARY KEY,
  nickname   TEXT,
  hidden     INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  closed     INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v_transactions is the read surface for every chart, list, and insight; the
-- base `transactions` table remains the write/export/provenance surface. Adding
-- the hidden-source filter HERE is what makes "hide" consistent app-wide in one
-- place. Exports and data health deliberately read the base table so hidden
-- rows are never silently dropped from a user's own data.
DROP VIEW IF EXISTS v_transactions;
CREATE VIEW v_transactions AS
SELECT
    t.*,
    COALESCE(co.new_category, t.category) AS effective_category
FROM transactions t
LEFT JOIN category_overrides co ON co.transaction_id = t.id
WHERE t.source NOT IN (SELECT source FROM account_meta WHERE hidden = 1);
