// Model B envelope encryption (decided 2026-06-13). The whole serialised SQLite
// is sealed under a per-user Data Encryption Key (DEK). The DEK is itself wrapped
// by a key derived from the user's password (KDF), so the server stores only
// wrapped key material + ciphertext and cannot read the ledger without the
// password. A recovery key independently wraps the same DEK, so a forgotten
// password does not mean lost data.
//
// This is NOT zero-knowledge end-to-end: the DEK and plaintext exist transiently
// in server memory during an active session and the PDF-parse window. The honest
// product claim is "encrypted at rest under your key", never "we can never see
// your data" (saying the latter while a server-side parse window exists is the
// FTC §5 policy-vs-practice trap).
//
// This file is the contract only. The implementation (Argon2id + AES-256-GCM,
// with round-trip / wrong-password / recovery / tamper tests) lands in Step 3.

// Wrapped DEK + KDF parameters, persisted per user alongside the ciphertext blob.
// `kdf`/`aead` are stored (not hardcoded) so a stronger KDF — e.g. Argon2id — can
// be introduced later as an additional algorithm without breaking existing
// envelopes; unlock reads the algorithm/params the envelope was sealed with.
export interface KeyEnvelope {
  kdf: string; // e.g. "pbkdf2-sha256"
  kdfParams: Record<string, number>; // e.g. { iterations: 600000 }
  salt: string; // base64 — KDF salt for the password path
  wrappedByPassword: string; // base64 — DEK sealed under the password-derived key
  wrappedByRecovery: string; // base64 — DEK sealed under the recovery key
  aead: string; // e.g. "AES-256-GCM" — algorithm used to seal the DB blob itself
}

// An unlocked session holds the raw DEK in memory and seals/opens the DB blob.
// Created by provision/unlock*; never persisted.
export interface SessionKey {
  // AEAD-encrypt serialised DB bytes (db.serialize() output) for storage.
  seal(plaintext: Uint8Array): Promise<Uint8Array>;
  // AEAD-decrypt a stored DB ciphertext blob. Throws on tamper or wrong key.
  open(ciphertext: Uint8Array): Promise<Uint8Array>;
}

export interface CryptoBox {
  // First sign-up: mint a DEK, wrap it under the password and a fresh recovery
  // key. Return the envelope to store, the recovery key to show the user ONCE,
  // and an unlocked session.
  provision(
    password: string
  ): Promise<{ envelope: KeyEnvelope; recoveryKey: string; session: SessionKey }>;

  // Normal login: unwrap the DEK via the password path. Throws on wrong password.
  unlockWithPassword(envelope: KeyEnvelope, password: string): Promise<SessionKey>;

  // Recovery path: unwrap the DEK via the recovery key.
  unlockWithRecoveryKey(envelope: KeyEnvelope, recoveryKey: string): Promise<SessionKey>;

  // Password change: re-wrap the SAME DEK under a new password. The data blob is
  // untouched (no re-encryption of the ledger), so this is cheap. Returns the new
  // envelope to persist.
  rewrapPassword(
    envelope: KeyEnvelope,
    session: SessionKey,
    newPassword: string
  ): Promise<KeyEnvelope>;
}
