import crypto from "crypto";
import { getDb } from "@/lib/db";
import { rotateSecret } from "./session";

export interface AppUser {
  display_name: string;
  created_at: string;
  updated_at: string;
  password_changed_at: string;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, SCRYPT.keyLen, SCRYPT)
    .toString("hex");
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt}:${hash}`;
}

function checkPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

export function getUser(): AppUser | null {
  const row = getDb()
    .prepare(
      "SELECT display_name, created_at, updated_at, password_changed_at FROM app_user WHERE id = 1"
    )
    .get() as AppUser | undefined;
  return row ?? null;
}

export function isConfigured(): boolean {
  return getUser() !== null;
}

export function createUser(displayName: string, password: string): void {
  getDb()
    .prepare("INSERT INTO app_user (id, display_name, password_hash) VALUES (1, ?, ?)")
    .run(displayName, hashPassword(password));
}

export function verifyPassword(password: string): boolean {
  const row = getDb()
    .prepare("SELECT password_hash FROM app_user WHERE id = 1")
    .get() as { password_hash: string } | undefined;
  if (!row) return false;
  return checkPassword(password, row.password_hash);
}

export function updateDisplayName(displayName: string): void {
  getDb()
    .prepare("UPDATE app_user SET display_name = ?, updated_at = datetime('now') WHERE id = 1")
    .run(displayName);
}

export function changePassword(newPassword: string): void {
  getDb()
    .prepare(
      `UPDATE app_user
       SET password_hash = ?, updated_at = datetime('now'), password_changed_at = datetime('now')
       WHERE id = 1`
    )
    .run(hashPassword(newPassword));
  // Invalidate every outstanding session cookie; caller issues a fresh one.
  rotateSecret();
}
