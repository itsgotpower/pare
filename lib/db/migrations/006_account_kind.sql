-- Account "kind": an analytics-facing classification of each account, decoupled
-- from the concrete `source` string. Lets imported data (Monarch / Mint / YNAB)
-- flow into the spend/outflow charts by setting a kind, instead of being keyed
-- off the hardcoded amex / cibc_visa / cibc_chequing source lists the queries
-- carry today. Also adds the `imports` table + transactions.import_id for
-- provenance and one-click rollback of migrated history.
--
-- Backfill makes this a NO-OP for existing data: every current row maps to the
-- same universe it occupied before, so the Part 2 query generalization
-- (source-string -> account_kind) is behaviour-preserving.

CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    row_count INTEGER NOT NULL DEFAULT 0,
    account_map TEXT,
    date_min TEXT,
    date_max TEXT
);

ALTER TABLE transactions ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK (account_kind IN ('card', 'chequing', 'savings', 'cash', 'investment', 'unknown'));
ALTER TABLE transactions ADD COLUMN import_id INTEGER REFERENCES imports(id);
ALTER TABLE statements ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK (account_kind IN ('card', 'chequing', 'savings', 'cash', 'investment', 'unknown'));

UPDATE transactions SET account_kind = 'card'     WHERE source IN ('amex', 'cibc_visa');
UPDATE transactions SET account_kind = 'chequing' WHERE source = 'cibc_chequing';
UPDATE statements   SET account_kind = 'card'     WHERE source IN ('amex', 'cibc_visa');
UPDATE statements   SET account_kind = 'chequing' WHERE source = 'cibc_chequing';

CREATE INDEX IF NOT EXISTS idx_transactions_account_kind ON transactions(account_kind);
CREATE INDEX IF NOT EXISTS idx_transactions_import_id ON transactions(import_id);
