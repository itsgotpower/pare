-- Rejected rule suggestions. A dismissal is keyed by the suggestion's identity
-- (keyword, category) so a rejected suggestion never resurfaces on the next
-- mining pass. Deliberately NOT wiped by the /api/data DANGER ZONE wipe —
-- dismissals are user intent, kept like rules/goals/marks.
CREATE TABLE IF NOT EXISTS suggestion_dismissals (
  keyword      TEXT NOT NULL,
  category     TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (keyword, category)
);
