import type { CryptoBox, KeyEnvelope, SessionKey } from "./crypto";

// WebCrypto implementation of the Model B envelope (see crypto.ts). Uses only
// globalThis.crypto (WebCrypto), so the SAME code runs in Node 20+ (local /
// self-host / tests) and in Cloudflare Workers/DO (the hosted target) — no
// runtime-specific rebuild.
//
//   KDF   : PBKDF2-HMAC-SHA256 (600k iterations) over the password → KEK
//   AEAD  : AES-256-GCM (12-byte random IV prepended to ciphertext+tag)
//   DEK   : 32 random bytes, AES-GCM-wrapped by the password-KEK and, separately,
//           by an HKDF expansion of a high-entropy recovery key
//
// PBKDF2 is the dependency-free, universally-available choice; the envelope
// records `kdf`, so Argon2id can be added later as a second algorithm.

const subtle = globalThis.crypto.subtle;
const DEFAULT_ITERATIONS = 600_000;
const DEK_BYTES = 32;
const SALT_BYTES = 16;
const RECOVERY_BYTES = 32;
const IV_BYTES = 12;
const RECOVERY_INFO = new TextEncoder().encode("parse-recovery-kek");

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
function unb64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
// Copy a (possibly offset/pooled) view into a standalone ArrayBuffer. WebCrypto's
// BufferSource params want an ArrayBuffer-backed view; TS 5.7 types a bare
// Uint8Array as ArrayBufferLike, which doesn't satisfy that — this coerces it.
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
const utf8 = (s: string) => new TextEncoder().encode(s);

// AES-256-GCM: output is iv(12) || ciphertext||tag, so the IV travels with the blob.
async function aesEncrypt(keyRaw: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ab(keyRaw), "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: ab(iv) }, key, ab(plaintext))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}
// Throws on wrong key or tampered ciphertext (GCM auth tag mismatch).
async function aesDecrypt(keyRaw: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ab(keyRaw), "AES-GCM", false, ["decrypt"]);
  const iv = blob.subarray(0, IV_BYTES);
  const ct = blob.subarray(IV_BYTES);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: ab(iv) }, key, ab(ct)));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await subtle.importKey("raw", ab(utf8(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: ab(salt), iterations, hash: "SHA-256" },
    material,
    256
  );
  return new Uint8Array(bits);
}

// The recovery key is already high-entropy, so HKDF (no slow KDF) is enough to
// turn it into a 256-bit key-encryption key.
async function recoveryKek(recoveryKeyBytes: Uint8Array): Promise<Uint8Array> {
  const material = await subtle.importKey("raw", ab(recoveryKeyBytes), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: ab(new Uint8Array(0)), info: ab(RECOVERY_INFO) },
    material,
    256
  );
  return new Uint8Array(bits);
}

// Holds the unwrapped DEK in memory for the session; seals/opens the DB blob.
class WebSessionKey implements SessionKey {
  constructor(readonly dek: Uint8Array) {}
  seal(plaintext: Uint8Array): Promise<Uint8Array> {
    return aesEncrypt(this.dek, plaintext);
  }
  open(ciphertext: Uint8Array): Promise<Uint8Array> {
    return aesDecrypt(this.dek, ciphertext);
  }
}

export class WebCryptoBox implements CryptoBox {
  // iterations affects provision/rewrap only; unlock uses the envelope's stored
  // count. Tests pass a smaller value for speed; production uses the default.
  constructor(private iterations: number = DEFAULT_ITERATIONS) {}

  async provision(
    password: string
  ): Promise<{ envelope: KeyEnvelope; recoveryKey: string; session: SessionKey }> {
    const dek = randomBytes(DEK_BYTES);

    const salt = randomBytes(SALT_BYTES);
    const kekPw = await pbkdf2(password, salt, this.iterations);
    const wrappedByPassword = b64(await aesEncrypt(kekPw, dek));

    const recoveryBytes = randomBytes(RECOVERY_BYTES);
    const kekRec = await recoveryKek(recoveryBytes);
    const wrappedByRecovery = b64(await aesEncrypt(kekRec, dek));

    const envelope: KeyEnvelope = {
      kdf: "pbkdf2-sha256",
      kdfParams: { iterations: this.iterations },
      salt: b64(salt),
      wrappedByPassword,
      wrappedByRecovery,
      aead: "AES-256-GCM",
    };
    // Shown to the user exactly once; base64url so it's copy-paste friendly.
    const recoveryKey = Buffer.from(recoveryBytes).toString("base64url");
    return { envelope, recoveryKey, session: new WebSessionKey(dek) };
  }

  async unlockWithPassword(envelope: KeyEnvelope, password: string): Promise<SessionKey> {
    const kekPw = await pbkdf2(password, unb64(envelope.salt), envelope.kdfParams.iterations);
    const dek = await aesDecrypt(kekPw, unb64(envelope.wrappedByPassword)); // throws if wrong
    return new WebSessionKey(dek);
  }

  async unlockWithRecoveryKey(envelope: KeyEnvelope, recoveryKey: string): Promise<SessionKey> {
    const kekRec = await recoveryKek(new Uint8Array(Buffer.from(recoveryKey, "base64url")));
    const dek = await aesDecrypt(kekRec, unb64(envelope.wrappedByRecovery)); // throws if wrong
    return new WebSessionKey(dek);
  }

  async rewrapPassword(
    envelope: KeyEnvelope,
    session: SessionKey,
    newPassword: string
  ): Promise<KeyEnvelope> {
    // Re-wrap the SAME DEK under a new password — the ledger blob is untouched.
    const dek = (session as WebSessionKey).dek;
    const salt = randomBytes(SALT_BYTES);
    const kekPw = await pbkdf2(newPassword, salt, this.iterations);
    const wrappedByPassword = b64(await aesEncrypt(kekPw, dek));
    return {
      ...envelope,
      kdf: "pbkdf2-sha256",
      kdfParams: { iterations: this.iterations },
      salt: b64(salt),
      wrappedByPassword,
      // wrappedByRecovery is independent of the password — leave it as-is.
    };
  }
}
