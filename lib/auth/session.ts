import fs from "fs";
import path from "path";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  randomHex,
  createSessionToken as mintToken,
  verifySessionToken as verifyToken,
} from "./session-token";

// Node-side secret STORE for the self-hosted single-user gate. The HMAC itself
// lives in the runtime-agnostic ./session-token (WebCrypto), which the Edge
// middleware imports directly — this module only resolves the secret and wraps
// the core with no-arg conveniences for the Node API routes. It must never touch
// the database (it's on the auth hot path) — only node:fs and the env.
//
// Secret resolution, in order:
//   1. process.env.PARE_AUTH_SECRET — the canonical, runtime-agnostic source.
//      This is the ONLY value the Edge middleware can read (no fs at the edge),
//      so set it whenever you want the middleware to gate pages in self-host. The
//      Node routes read the SAME value here, keeping both runtimes in agreement.
//   2. data/auth-secret — a generated, rotating file secret. Zero-config fallback
//      for local Node-only use; the Edge middleware cannot see it, so without (1)
//      the middleware treats every request as signed-out.
//
// The secret is rotated on password change in FILE mode — see rotateSecret —
// which invalidates every outstanding cookie at once. Under an ENV secret there
// is nothing the app can rotate (the value is externally managed and the Edge
// middleware, which can't read the DB or a file, verifies against it), so a
// password change does NOT auto-invalidate other sessions: the operator must
// rotate PARE_AUTH_SECRET and restart. rotateSecret returns which case applied
// so the change-password handler can tell the user the truth.

const SECRET_PATH = process.env.PARE_DB_PATH
  ? path.join(path.dirname(process.env.PARE_DB_PATH), "auth-secret")
  : path.join(process.cwd(), "data", "auth-secret");

export { SESSION_COOKIE, SESSION_TTL_MS };

function envSecret(): string | null {
  const s = process.env.PARE_AUTH_SECRET?.trim();
  return s ? s : null;
}

// No in-memory caching of the file secret: the routes are separate module
// instances, so a cached copy goes stale the moment the file changes (secret
// rotation on password change) — tokens then sign with one secret and verify
// against another, locking the user out until a server restart. The file is
// 64 bytes; read it every time.
function readSecretFile(): string | null {
  try {
    return fs.readFileSync(SECRET_PATH, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

function writeSecretFile(secret: string): void {
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
}

// The secret used to VERIFY (no side effects). Prefer the env secret.
function readSecret(): string | null {
  return envSecret() ?? readSecretFile();
}

// The secret used to SIGN. With an env secret there's nothing to create; in file
// mode, generate-and-persist on first use.
function ensureSecret(): string {
  const env = envSecret();
  if (env) return env;
  const existing = readSecretFile();
  if (existing) return existing;
  const secret = randomHex(32);
  writeSecretFile(secret);
  return secret;
}

// Rotate the file secret, killing every outstanding session. Returns true when
// rotation actually happened (file mode). Returns FALSE — a no-op — when an env
// secret is in force: it's externally managed, so outstanding sessions survive
// until the operator changes PARE_AUTH_SECRET and restarts. Callers use the
// return value to tell the user whether other sessions were actually revoked.
export function rotateSecret(): boolean {
  if (envSecret()) return false;
  writeSecretFile(randomHex(32));
  return true;
}

// Token format: <expiresAtMs>.<nonce>.<hmac(expiresAtMs.nonce)>. Async because
// the WebCrypto HMAC core is async.
export function createSessionToken(): Promise<string> {
  return mintToken(ensureSecret());
}

export function verifySessionToken(token: string | undefined): Promise<boolean> {
  return verifyToken(token, readSecret());
}
