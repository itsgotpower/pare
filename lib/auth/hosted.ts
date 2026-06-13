import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins";
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
  return {
    // Kysely over the D1 dialect. better-auth detects this as a "sqlite"
    // dialect for query generation; the 006 migration provides the schema
    // (we do NOT let better-auth auto-create tables in production).
    database: {
      dialect: new D1Dialect({ database: db }),
      type: "sqlite",
    },
    // Trusted origins / base URL come from the environment in the Worker; the
    // secret is required in hosted mode (cookie signing + token hashing).
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      // Resend-backed reset email. Not awaited inside better-auth to avoid
      // leaking timing about whether the address exists.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },
    // bearer() lets the mobile client authenticate with an Authorization:
    // Bearer header instead of a cookie. Sessions are still the underlying
    // primitive — the token IS the session token, returned via set-auth-token.
    plugins: [bearer()],
  };
}

export function createHostedAuth(db: D1Like) {
  return betterAuth(hostedAuthOptions(db));
}

export type HostedAuth = ReturnType<typeof createHostedAuth>;
