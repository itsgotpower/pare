-- Hosted-mode account system: better-auth's core schema (email + password,
-- sessions, password-reset verification, bearer tokens for the Expo app).
--
-- This lives in the D1 AUTH database ONLY (binding `DB`, database `pare-auth`),
-- applied via `wrangler d1 migrations apply pare-auth` (see the deployment docs). It is
-- deliberately NOT in lib/db/migrations/ (the bundled MIGRATIONS array that runs
-- against the per-user Durable Object data DBs and the self-host file DB) — auth
-- tables must never be created inside a user's data DB, and the app schema must
-- never be created in the auth DB. Two databases, two migration sets.
--
-- Self-hosted mode does not use better-auth (it keeps the single-user gate,
-- app_user / migration 002) and so never applies this file.
--
-- Generated from better-auth 1.6.x (`@better-auth/cli generate`) for the
-- emailAndPassword + bearer() configuration in lib/auth/hosted.ts, then
-- formatted to match this project's migration style. The bearer plugin needs
-- NO extra tables — the bearer token IS the session token (session.token).
-- Keep this in sync with lib/auth/hosted.ts if plugins/fields change.

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
