// ---------------------------------------------------------------------------
// session-token.ts — runtime-agnostic stateless session token (WebCrypto).
//
// This module is the Edge/Workers-safe core of the self-hosted session gate. It
// uses ONLY the WebCrypto global `crypto` (SubtleCrypto + getRandomValues), so the
// SAME code runs in Node 20+ (self-host / dev / tests) AND in the Cloudflare
// Workers runtime — no node:crypto, no node:fs, nothing the @opennextjs/cloudflare
// bundler has to polyfill. That's what lets proxy.ts (a Node-runtime Proxy that
// Cloudflare must bundle) import the verifier without dragging node:fs into the
// Worker bundle and breaking cf:build.
//
// The secret is NOT owned here: every function takes it as a parameter. The Node
// self-host secret store (file-backed, rotating) lives in session.ts; the hosted
// target doesn't use this path at all (better-auth gates per-request). This split
// keeps the crypto pure and the I/O (fs in self-host, env binding if ever wired)
// at the edges.
//
// Token format (unchanged): <expiresAtMs>.<nonce>.<hmac(expiresAtMs.nonce)>
// HMAC: HMAC-SHA256, hex-encoded. verify() is constant-time via subtle.verify.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "pare_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const subtle = crypto.subtle;
const utf8 = new TextEncoder();

// WebCrypto wants an ArrayBuffer-backed view; a bare Uint8Array types as
// ArrayBufferLike under TS, which doesn't satisfy BufferSource. Copy to a
// standalone ArrayBuffer.
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// Parse an even-length hex string to bytes, or null if it isn't valid hex.
// Used on the attacker-supplied MAC, so it must never throw.
function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

// Random hex string of `bytes` bytes (2*bytes chars). WebCrypto CSPRNG.
export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function importKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    ab(utf8.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await importKey(secret, "sign");
  const mac = await subtle.sign("HMAC", key, ab(utf8.encode(payload)));
  return toHex(new Uint8Array(mac));
}

/**
 * Mint a token signed by `secret`. Async because WebCrypto is async.
 */
export async function createSessionToken(secret: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const nonce = randomHex(16);
  const payload = `${expiresAt}.${nonce}`;
  return `${payload}.${await sign(payload, secret)}`;
}

/**
 * Verify a token against `secret`. Returns false for any missing/expired/
 * malformed/forged token or absent secret — never throws. The MAC check is
 * constant-time (subtle.verify).
 */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string | null | undefined
): Promise<boolean> {
  if (!token || !secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, mac] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;

  const macBytes = fromHex(mac);
  if (!macBytes) return false;

  const key = await importKey(secret, "verify");
  return subtle.verify("HMAC", key, ab(macBytes), ab(utf8.encode(`${expiresAt}.${nonce}`)));
}
