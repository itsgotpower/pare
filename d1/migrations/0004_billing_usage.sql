-- Hosted-mode metering: monthly usage counters for plan-limit enforcement.
--
-- Lives in the D1 AUTH database (binding `DB`, database `pare-auth`), applied via
-- `wrangler d1 migrations apply pare-auth`. Counting usage here (one indexed
-- D1 write per accepted upload) keeps enforcement off the per-user Durable
-- Object's hot path — the upload route can decide allow/deny before doing any DO
-- work. See cloud/metering/usage.ts (writer/reader) and cloud/billing/gate.ts
-- (the enforce + record facade the upload route calls).
--
-- `period` is a calendar month 'YYYY-MM' (UTC). One row per (user, month);
-- `statements` is the count of statement uploads accepted that month. Rows are
-- never deleted on rollover — a fresh month simply starts a new row.
--
-- Self-hosted mode never applies this file (no plan limits, no metering).

CREATE TABLE IF NOT EXISTS "billing_usage" (
  "userId"     TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "period"     TEXT NOT NULL,
  "statements" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("userId", "period")
);
