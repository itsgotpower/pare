-- Hosted-mode SimpleFIN integrations: one row per user holding the connection
-- state (access URL, per-account classification, autoSync flag, sync
-- watermarks) as a JSON blob — the SAME SimplefinConfig shape self-host keeps
-- in gitignored data/simplefin.json, so the sync core (lib/simplefin/sync.ts)
-- is identical on both targets.
--
-- Lives in the D1 AUTH database (binding `DB`, database `pare-auth`), applied
-- via `wrangler d1 migrations apply pare-auth`. Deliberately OUTSIDE the user's
-- Durable Object: the access URL is a bearer secret and must stay out of the
-- user-exportable data (DO backups / ?format=backup), and the daily cron
-- (cloud/simplefin/scheduled.ts) needs one cheap scan for due integrations
-- without waking every user's DO.
--
-- A blob, not columns, because the only access patterns are load/save/clear by
-- userId plus the cron's full scan. If the user count ever makes that scan
-- hurt, promote autoSync/lastSyncedAt to indexed columns.
--
-- Self-hosted mode never applies this file (connection state lives on disk).

CREATE TABLE IF NOT EXISTS "simplefin_integration" (
  "userId"    TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "config"    TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
