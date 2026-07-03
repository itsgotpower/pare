-- Web Push subscriptions (installed-PWA notifications). One row per browser
-- endpoint; endpoint is the natural key — re-subscribing the same browser
-- replaces its keys.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
