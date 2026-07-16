-- Remote MCP connector (better-auth `mcp` plugin, lib/auth/hosted.ts): the
-- OAuth-provider tables backing claude.ai Connectors — dynamically registered
-- clients (Anthropic registers one via DCR, so `userId` is nullable), issued
-- access/refresh tokens, and per-user consent grants. Spec:
-- internal/remote-mcp-spec.md.
--
-- Like 0001/0002, this lives in the D1 AUTH database ONLY (binding `DB`,
-- database `pare-auth`), applied via `wrangler d1 migrations apply pare-auth`.
-- better-auth does NOT auto-create tables here, so this schema is hand-authored
-- to match the plugin's model (dump it with:
--   node -e "…mcp({loginPage:'/login'}).schema…"
-- ) and must be kept in sync with better-auth's mcp/oidc-provider plugin if its
-- fields change.
--
-- Type mapping (better-auth model -> sqlite/D1): string -> TEXT, boolean ->
-- INTEGER (0/1), date -> DATE. Token/consent rows reference the user with
-- ON DELETE CASCADE — account deletion must revoke connector access with it
-- (the hard-delete invariant). oauthApplication.userId stays NULL for
-- DCR-registered clients, so client rows survive user deletion by design.

CREATE TABLE IF NOT EXISTS "oauthApplication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "icon" TEXT,
  "metadata" TEXT,
  "clientId" TEXT,
  "clientSecret" TEXT,
  "redirectUrls" TEXT,
  "type" TEXT,
  "disabled" INTEGER,
  "userId" TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
  "createdAt" DATE,
  "updatedAt" DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauthApplication_clientId_idx"
  ON "oauthApplication" ("clientId");

CREATE TABLE IF NOT EXISTS "oauthAccessToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "clientId" TEXT,
  "userId" TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
  "scopes" TEXT,
  "createdAt" DATE,
  "updatedAt" DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauthAccessToken_accessToken_idx"
  ON "oauthAccessToken" ("accessToken");
CREATE UNIQUE INDEX IF NOT EXISTS "oauthAccessToken_refreshToken_idx"
  ON "oauthAccessToken" ("refreshToken");
CREATE INDEX IF NOT EXISTS "oauthAccessToken_userId_idx"
  ON "oauthAccessToken" ("userId");

CREATE TABLE IF NOT EXISTS "oauthConsent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT,
  "userId" TEXT REFERENCES "user" ("id") ON DELETE CASCADE,
  "scopes" TEXT,
  "createdAt" DATE,
  "updatedAt" DATE,
  "consentGiven" INTEGER
);

CREATE INDEX IF NOT EXISTS "oauthConsent_userId_idx"
  ON "oauthConsent" ("userId");
