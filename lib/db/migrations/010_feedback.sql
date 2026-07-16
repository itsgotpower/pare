-- In-app product feedback. Hosted: rows land in the shared (tenant-less) DO via
-- getSharedRepo() and are read through the token-gated admin export on
-- GET /api/feedback — there is no in-app read surface. Self-host installs point
-- users at GitHub issues instead, so this table only fills there during local
-- dev testing. email is optional and user-typed (never auto-attached from the
-- account) — contact opt-in is explicit.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  message TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
