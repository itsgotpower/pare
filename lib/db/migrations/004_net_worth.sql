-- Statement-cadence net worth: persist each statement's closing balance
-- (as printed — positive means owed for cards) plus the closing date,
-- and a manual assets/liabilities table for non-statement items
-- (investments, vehicle) keyed by effective date.

ALTER TABLE statements ADD COLUMN closing_balance REAL;
ALTER TABLE statements ADD COLUMN closing_date TEXT;

CREATE TABLE IF NOT EXISTS manual_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
    amount REAL NOT NULL,
    effective_date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manual_entries_name_date
    ON manual_entries(name, effective_date);
