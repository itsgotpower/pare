-- Hosted-mode passkeys / WebAuthn: the `passkey` model for the @better-auth/
-- passkey plugin (lib/auth/hosted.ts). One row per registered credential.
--
-- Like 0001, this lives in the D1 AUTH database ONLY (binding `DB`, database
-- `pare-auth`), applied via `wrangler d1 migrations apply pare-auth`. It is NOT
-- in lib/db/migrations/ — auth tables never go in a user's data DB. better-auth
-- does NOT auto-create tables here, so this schema is hand-authored to match the
-- plugin's model and must be kept in sync with @better-auth/passkey if its
-- fields change (see the field map in node_modules/@better-auth/passkey).
--
-- Type mapping (better-auth model -> sqlite/D1): string -> TEXT, number ->
-- INTEGER, boolean -> INTEGER (0/1), date -> DATE. `userId` and `credentialID`
-- are declared index: true by the plugin. ON DELETE CASCADE so removing a user
-- (cascaded from `user` in 0001) drops their passkeys with them.

CREATE TABLE IF NOT EXISTS "passkey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" DATE,
  "aaguid" TEXT
);

CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("userId");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey" ("credentialID");
