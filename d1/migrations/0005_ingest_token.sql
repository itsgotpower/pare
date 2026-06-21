-- Hosted-mode email ingest: per-user "forward your statements here" address.
--
-- Lives in the D1 AUTH database (binding `DB`, database `pare-auth`), applied via
-- `wrangler d1 migrations apply pare-auth` — NOT in lib/db/migrations/ (those run
-- against the per-user Durable Object data DBs). It maps an unguessable token
-- (the local-part of <token>@in.pare.money) to a better-auth user id, so an
-- INBOUND email — which carries NO session cookie or bearer token — can be
-- resolved to the user whose Durable Object the statement should land in.
--
-- The token IS the routing credential, so it must be unguessable (128-bit,
-- base32) and rotatable; rotating replaces the single row (ON CONFLICT) and the
-- old address stops resolving immediately. See lib/ingest/token.ts.
--
-- One row per user (PRIMARY KEY userId); `token` is globally UNIQUE so the
-- reverse lookup (token -> userId) is an indexed point read. FK CASCADE so an
-- account deletion drops the address with it.
--
-- Self-hosted mode never applies this file (single-user, local files, no ingest).

CREATE TABLE IF NOT EXISTS "ingest_token" (
  "userId"    TEXT NOT NULL PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "token"     TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL
);
