-- Pre-launch marketing waitlist (hosted-product signups from the public homepage).
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'homepage',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
