import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer, captcha, mcp } from "better-auth/plugins";
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
//   - "Continue with Google" (socialProviders.google, gated on the
//     GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET secrets — INERT until provisioned).
//     Web only for now; the Expo app would need the native ID-token flow.
//     Google is an ADDITIONAL door alongside email+password, never the only one.
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

  // Remote MCP connector (claude.ai Settings → Connectors). The mcp() plugin
  // turns this better-auth instance into the OAuth 2.1 provider the MCP spec
  // requires: dynamic client registration, PKCE authorize/token endpoints under
  // /api/auth/oauth2|mcp/*, and getMcpSession() for the /api/mcp route's
  // withMcpAuth wrapper. Unauthenticated authorize flows redirect to /login
  // (which already handles same-app ?from= redirects). Tables live in the D1
  // auth DB (d1/migrations/0007_mcp_oauth.sql — hand-authored, keep in sync).
  //
  // consentPage: the plugin's authorize consents ONLY when the client sends
  // prompt=consent, so /api/mcp-authorize (the endpoint our discovery document
  // advertises) forces that prompt and this page renders the ALLOW/DENY step.
  // Spec: internal/remote-mcp-spec.md (finding #2).
  // `resource` MUST be the canonical URI of the MCP SERVER (RFC 9728 §2 +
  // the MCP authorization spec), i.e. the endpoint the client actually POSTs
  // to — NOT the origin. The plugin defaults it to `new URL(baseURL).origin`,
  // which advertised `https://pare.money` while the server lives at
  // `https://pare.money/api/mcp`. claude.ai fetches the protected-resource doc
  // named in our 401 challenge, compares `resource` against the endpoint it is
  // connecting to, and on mismatch discards the token it just obtained —
  // surfacing as "Authorization with pare.money failed" with NO second request
  // to /api/mcp. Verified against prod 2026-07-16: every server step returned
  // 2xx (register 201 → consent 200 → token 200) and the client then went
  // silent. Setting this fixes BOTH metadata routes at once, since our
  // /.well-known copy proxies the same getMCPProtectedResource endpoint.
  // Omitted when BETTER_AUTH_URL is unset (dev/self-host) so the plugin's
  // origin default still applies rather than an "undefined/api/mcp" string.
  const mcpBaseUrl = process.env.BETTER_AUTH_URL?.replace(/\/$/, "");
  plugins.push(
    mcp({
      loginPage: "/login",
      ...(mcpBaseUrl ? { resource: `${mcpBaseUrl}/api/mcp` } : {}),
      // loginPage is duplicated because the OIDCOptions type requires it here;
      // at runtime the plugin overrides oidcConfig.loginPage with the outer one.
      oidcConfig: { loginPage: "/login", consentPage: "/oauth/consent" },
    })
  );

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

  // "Continue with Google". Gated on BOTH secrets (wrangler secret put
  // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) so it's inert until provisioned —
  // dev/test and a not-yet-configured deploy simply have no google provider,
  // and the login page hides the button (see the capability flag in
  // app/api/auth/route.ts hostedDisabled()). The Google Cloud OAuth client's
  // authorized redirect URI must be <BETTER_AUTH_URL>/api/auth/callback/google.
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const socialProviders: BetterAuthOptions["socialProviders"] =
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            // Same launch gate as email/password: a social provider is its own
            // sign-up door, so PARE_SIGNUP_DISABLED must close BOTH or Google
            // becomes a back door around a closed signup. Existing accounts
            // keep signing in either way.
            disableSignUp: envFlag(process.env.PARE_SIGNUP_DISABLED),
          },
        }
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
    socialProviders,
    // A Google sign-in whose (Google-verified) email matches an existing
    // email+password account must land in THAT account, not mint a duplicate —
    // a duplicate would get a fresh empty Durable Object ("where did my data
    // go?"). Safe to trust here because google asserts email_verified and our
    // email accounts are verification-required, so there's no
    // unverified-address takeover path.
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
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
