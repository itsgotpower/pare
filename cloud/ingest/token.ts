/**
 * PROPRIETARY — pare.money commercial layer. See ../LICENSE. Not AGPL.
 *
 * Per-user email-ingest address: <token>@<INGEST_DOMAIN>. Users forward bank
 * statement emails here; the inbound Email Worker resolves the local-part token
 * back to a better-auth user id (lookupUserByIngestToken) and routes the PDF into
 * that user's existing parse pipeline (handleHostedUpload).
 *
 * Email-in is a HOSTED, monetizable convenience — a differentiator we keep out of
 * the AGPL core, hence cloud/. The token IS the routing credential for an email
 * that carries no session, so it must be unguessable (128 bits) and rotatable.
 *
 * Backed by the D1 `ingest_token` table (d1/migrations/0005_ingest_token.sql),
 * one row per user. Every exported query takes an optional `db` so it runs
 * against either the real D1 binding (default, via getD1()) or a better-sqlite3
 * shim in tests.
 */

import type { D1Like } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";

export const INGEST_DOMAIN = process.env.PARE_INGEST_DOMAIN ?? "in.pare.money";

// RFC 4648 base32, lowercase — every character is a safe email local-part char
// ([a-z2-7]), so a token drops straight into an address with no escaping.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A fresh, unguessable token. 16 random bytes -> 128 bits -> 26 chars. */
export function generateIngestToken(byteLength = 16): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The full address a user forwards statements to. */
export function formatIngestAddress(token: string): string {
  return `${token}@${INGEST_DOMAIN}`;
}

async function conn(db?: D1Like): Promise<D1Like> {
  return db ?? (await getD1());
}

/**
 * Resolve an inbound address's local-part token back to the owning user id, or
 * null if it matches no one. This is the ONLY trust boundary on the email-in path
 * (the message has no cookie/bearer), so callers MUST treat null as "reject the
 * mail" — never "fall back to a default user".
 */
export async function lookupUserByIngestToken(
  token: string,
  db?: D1Like
): Promise<string | null> {
  if (!token) return null;
  const c = await conn(db);
  const row = await c
    .prepare('SELECT "userId" FROM "ingest_token" WHERE "token" = ?')
    .bind(token)
    .first<{ userId?: string }>();
  return row?.userId ?? null;
}

/** The user's token, creating one on first call. Stable across later calls. */
export async function getOrCreateIngestToken(
  userId: string,
  db?: D1Like
): Promise<string> {
  const c = await conn(db);
  const existing = await c
    .prepare('SELECT "token" FROM "ingest_token" WHERE "userId" = ?')
    .bind(userId)
    .first<{ token?: string }>();
  if (existing?.token) return existing.token;

  const token = generateIngestToken();
  // OR IGNORE so a concurrent create (two tabs) can't trip the userId PK; whoever
  // lost the race simply re-reads the winning row below.
  await c
    .prepare(
      'INSERT OR IGNORE INTO "ingest_token" ("userId","token","createdAt") VALUES (?, ?, ?)'
    )
    .bind(userId, token, new Date().toISOString())
    .run();
  const row = await c
    .prepare('SELECT "token" FROM "ingest_token" WHERE "userId" = ?')
    .bind(userId)
    .first<{ token?: string }>();
  return row?.token ?? token;
}

/**
 * Mint a fresh token for the user, replacing any existing one. The previous
 * address stops resolving the moment this commits — use it to recover from a
 * leaked address.
 */
export async function rotateIngestToken(
  userId: string,
  db?: D1Like
): Promise<string> {
  const c = await conn(db);
  const token = generateIngestToken();
  await c
    .prepare(
      'INSERT INTO "ingest_token" ("userId","token","createdAt") VALUES (?, ?, ?) ' +
        'ON CONFLICT("userId") DO UPDATE SET "token" = excluded."token", "createdAt" = excluded."createdAt"'
    )
    .bind(userId, token, new Date().toISOString())
    .run();
  return token;
}
