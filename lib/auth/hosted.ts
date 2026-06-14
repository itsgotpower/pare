import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, captcha } from "better-auth/plugins";
import { D1Dialect } from "kysely-d1";
import { sendPasswordResetEmail } from "./email";

// Hosted-mode account system (better-auth on Cloudflare D1).
//
// Self-hosted mode keeps the single-user gate (lib/auth/session.ts +
// lib/auth/user.ts + proxy.ts). This module is the HOSTED path, selected by
// PARSE_DEPLOY_TARGET=hosted (see lib/auth/resolve.ts). It covers:
//   - email + password
//   - password reset via Resend (sendResetPassword -> lib/auth/email.ts)
//   - bearer tokens for the Expo mobile app (bearer() plugin: sign-in returns a
//     `set-auth-token` header the client stores and replays as
//     `Authorization: Bearer <token>`; getSession resolves it transparently).
//
// On Cloudflare Workers the D1 binding only exists inside the request scope, so
// the auth instance MUST be built per-request from that binding — there is no
// module-level singleton to export. `createHostedAuth(db)` is that factory.
// `db` is anything Kysely's D1Dialect accepts: a real D1Database binding in
// Workers, or a D1-compatible shim (better-sqlite3 + a tiny adapter) in
// dev/test. The returned object exposes `auth.api.getSession({ headers })`,
// which resolveUser() calls for both cookies and bearer tokens.

export type D1Like = ConstructorParameters<typeof D1Dialect>[0]["database"];

export function hostedAuthOptions(db: D1Like): BetterAuthOptions {
  // Fail closed if the signing secret is missing. better-auth otherwise falls
  // back to a PUBLIC default secret ("better-auth-secret-1234…") whenever it
  // doesn't detect production — which would make every session cookie and bearer
  // token forgeable, letting anyone mint a token for any userId and walk straight
  // into that user's Durable Object. Refuse to start instead. Provision it with
  // `wrangler secret put BETTER_AUTH_SECRET` (see DEPLOY.md).
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Hosted mode requires it for session/token " +
        "signing; set it with `wrangler secret put BETTER_AUTH_SECRET`."
    );
  }

  // bearer() lets the mobile client authenticate with an Authorization: Bearer
  // header. PHASE 4: when TURNSTILE_SECRET_KEY is set, also enforce Cloudflare
  // Turnstile on the auth mutations (sign-up/sign-in/forget-password) — the
  // client sends the token as an `x-captcha-response` header. Gated on the secret
  // so it's INERT until provisioned (dev/test/self-host and the current web UI,
  // which doesn't send a token yet, are unaffected); enabling it without an
  // updated client would (correctly) start rejecting tokenless auth POSTs.
  const plugins: NonNullable<BetterAuthOptions["plugins"]> = [bearer()];
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    plugins.push(
      captcha({ provider: "cloudflare-turnstile", secretKey: turnstileSecret })
    );
  }

  return {
    // Kysely over the D1 dialect. better-auth detects this as a "sqlite"
    // dialect for query generation; the auth-D1 migration (d1/migrations/
    // 0001_better_auth.sql, applied via `wrangler d1 migrations apply parse-auth`)
    // provides the schema (we do NOT let better-auth auto-create tables).
    database: {
      dialect: new D1Dialect({ database: db }),
      type: "sqlite",
    },
    // Trusted origins / base URL come from the environment in the Worker; the
    // secret is required in hosted mode (cookie signing + token hashing).
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      // Resend-backed reset email. Not awaited inside better-auth to avoid
      // leaking timing about whether the address exists.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },
    // Sessions are the underlying primitive — the bearer token IS the session
    // token (returned via set-auth-token). Captcha (when configured) is appended
    // above so it runs before the email/password handlers.
    plugins,
  };
}

export function createHostedAuth(db: D1Like) {
  return betterAuth(hostedAuthOptions(db));
}

export type HostedAuth = ReturnType<typeof createHostedAuth>;
