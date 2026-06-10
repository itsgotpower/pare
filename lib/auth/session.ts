import crypto from "crypto";
import fs from "fs";
import path from "path";

// This module is imported by proxy.ts, so it must not touch the database —
// only node:crypto and the secret file. The signing secret lives next to the
// DB in gitignored data/ and is rotated on password change, which invalidates
// every outstanding session cookie at once.

const SECRET_PATH = process.env.PARSE_DB_PATH
  ? path.join(path.dirname(process.env.PARSE_DB_PATH), "auth-secret")
  : path.join(process.cwd(), "data", "auth-secret");

export const SESSION_COOKIE = "parse_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// No in-memory caching: the proxy and the API routes are separate module
// instances, so a cached copy goes stale the moment the file changes (secret
// rotation on password change) — tokens then sign with one secret and verify
// against another, locking the user out until a server restart. The file is
// 64 bytes; read it every time.
function readSecret(): string | null {
  try {
    return fs.readFileSync(SECRET_PATH, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function ensureSecret(): string {
  const existing = readSecret();
  if (existing) return existing;
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

export function rotateSecret(): void {
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Token format: <expiresAtMs>.<nonce>.<hmac(expiresAtMs.nonce)>
export function createSessionToken(): string {
  const secret = ensureSecret();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const secret = readSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, mac] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;

  const expected = sign(`${expiresAt}.${nonce}`, secret);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
