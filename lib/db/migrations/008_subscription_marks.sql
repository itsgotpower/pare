-- Subscriptions the user has marked to cancel. slug is merchantSlug() of the
-- charge description — the same key the /merchants drill-down uses — so a mark
-- survives DB wipes of transactions (marks are kept like rules/goals).
-- monthly_cost is a snapshot at mark time: the "saving $X/yr" figure once the
-- charges stop, independent of the shrinking recomputed average.
CREATE TABLE IF NOT EXISTS subscription_marks (
  slug TEXT PRIMARY KEY,
  merchant TEXT NOT NULL,
  marked_at TEXT NOT NULL,
  monthly_cost REAL NOT NULL
);
