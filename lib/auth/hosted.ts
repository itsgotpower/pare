import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, captcha } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { D1Dialect } from "kysely-d1";
import { sendPasswordResetEmail, sendVerificationEmail } from "./email";

// Hosted-mode account system (better-auth on Cloudflare D1).
//
// Self-hosted mode keeps the single-user gate (lib/auth/session.ts +
// lib/auth/user.ts + proxy.ts). This module is the HOSTED path, selected by
// PARE_DEPLOY_TARGET=hosted (see lib/auth/resolve.ts). It covers:
//   - email + password
//   - password reset via Resend (sendResetPassword -> lib/auth/email.ts)
//   - passkeys / WebAuthn (passkey() plugin, @better-auth/passkey): adds
//     /api/auth/passkey/* endpoints (generate-register/authenticate-options,
//     verify, list-passkeys, delete-passkey). The `passkey` table is in the D1
//     auth DB (d1/migrations/0002_passkey.sql) — KEEP THAT MIGRATION IN SYNC
//     with the plugin's model if it changes. Passkeys are an ADDITIONAL door
//     alongside email+password, never the only one.
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


// String env vars have no boolean semantics of their own: Boolean("0") is true.
// Treat the conventional falsy spellings as OFF; anything else non-empty is ON.
function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function hostedAuthOptions(db: D1Like): BetterAuthOptions {
  // Fail closed if the signing secret is missing. better-auth otherwise falls
  // back to a PUBLIC default secret ("better-auth-secret-1234…") whenever it
  // doesn't detect production — which would make every session cookie and bearer
  // token forgeable, letting anyone mint a token for any userId and walk straight
  // into that user's Durable Object. Refuse to start instead. Provision it with
  // `wrangler secret put BETTER_AUTH_SECRET` (see the deployment docs).
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

  // Passkeys / WebAuthn. rpID (the relying-party id) and origin MUST match the
  // deployed host or the browser refuses the ceremony, so derive both from
  // BETTER_AUTH_URL when set (prod). In dev/test BETTER_AUTH_URL is localhost or
  // unset — omit the options so the plugin's localhost defaults apply (rpID
  // "localhost", origin supplied by the client). rpName is the human label shown
  // in the OS passkey prompt.
  const authUrl = process.env.BETTER_AUTH_URL;
  const rp = authUrl ? new URL(authUrl) : null;
  plugins.push(
    passkey({
      rpName: "Pare",
      ...(rp ? { rpID: rp.hostname, origin: rp.origin } : {}),
    })
  );

  // Trusted origins (mobile-ready scaffolding). better-auth defaults trustedOrigins
  // to [baseURL], which covers the web app and native BEARER calls (a native client
  // sends no Origin header, so it's never origin-checked). The Expo app's
  // cookie-style flows — sign-up/sign-in redirects and the email-verification deep
  // link — DO need their origin allow-listed once the bundle id exists: the Expo
  // app scheme (e.g. `pare://`) and/or a universal link (`https://pare.money`). Feed
  // those via PARE_TRUSTED_ORIGINS (comma-separated). INERT until set: with the var
  // unset, trustedOrigins stays undefined and better-auth's baseURL default applies
  // unchanged — so dev/test/self-host and today's web deploy behave exactly as before.
  // When set, we include the baseURL origin first so enabling extras never drops the
  // default. See internal mobile-plan workstream 2 / deploy-unblock "mobile deltas".
  const extraOrigins = (process.env.PARE_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const trustedOrigins = extraOrigins.length
    ? [...(authUrl ? [new URL(authUrl).origin] : []), ...extraOrigins]
    : undefined;

  return {
    // Kysely over the D1 dialect. better-auth detects this as a "sqlite"
    // dialect for query generation; the auth-D1 migration (d1/migrations/
    // 0001_better_auth.sql, applied via `wrangler d1 migrations apply pare-auth`)
    // provides the schema (we do NOT let better-auth auto-create tables).
    database: {
      dialect: new D1Dialect({ database: db }),
      type: "sqlite",
    },
    // Trusted origins / base URL come from the environment in the Worker; the
    // secret is required in hosted mode (cookie signing + token hashing).
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    // Only set when PARE_TRUSTED_ORIGINS adds extra origins (mobile); otherwise
    // omitted so better-auth's [baseURL] default stands. See the comment above.
    ...(trustedOrigins ? { trustedOrigins } : {}),
    emailAndPassword: {
      enabled: true,
      // Stage-A launch gate: while PARE_SIGNUP_DISABLED is truthy, better-auth's
      // sign-up route rejects with EMAIL_PASSWORD_SIGN_UP_DISABLED — existing
      // accounts sign in normally, new registrations are closed. The full-app
      // deploy ships with this ON (wrangler.toml [vars]) until the waitlist
      // invite machinery exists; flip the var (dashboard Settings → Variables,
      // or wrangler.toml + redeploy) to open signup. Unset in dev/self-host, so
      // local flows are unaffected. envFlag treats "0"/"false"/"off"/"no" as
      // OFF — env vars are strings, and Boolean("0") === true already caused a
      // silently-still-closed gate during first-account setup.
      disableSignUp: envFlag(process.env.PARE_SIGNUP_DISABLED),
      // Finance app: don't let an account act on data until it has proven it
      // controls the email address. With this on, better-auth rejects sign-in
      // for an unverified account (403) and re-sends the verification link, so
      // signing up with someone else's address can't yield a usable session.
      requireEmailVerification: true,
      // Resend-backed reset email. Not awaited inside better-auth to avoid
      // leaking timing about whether the address exists.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url);
      },
    },
    // Verification email is sent automatically on sign-up (and on a blocked
    // sign-in). `url` is better-auth's /api/auth/verify-email link; clicking it
    // marks the account verified and — with autoSignInAfterVerification — issues
    // a session and redirects on. When RESEND_API_KEY is unset (dev/test) the
    // link is logged instead of sent, so the flow stays exercisable locally.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user.email, url);
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
