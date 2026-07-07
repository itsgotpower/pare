import { test } from "node:test";
import assert from "node:assert/strict";

// Option-wiring proof for the hosted auth config (no better-auth instance is
// built — hostedAuthOptions() is pure config assembly, so a dummy stands in
// for the D1 binding). Covers the Google provider gating:
//   - inert until BOTH secrets exist (a half-configured deploy gets no provider)
//   - PARE_SIGNUP_DISABLED closes the social sign-up door too, mirroring
//     emailAndPassword.disableSignUp — otherwise Google is a back door around
//     a closed launch gate
//   - google is a trusted linking provider, so a Google sign-in with a
//     (Google-verified) email matching an existing account links instead of
//     minting a duplicate user with an empty DO

process.env.BETTER_AUTH_SECRET ||= "test-secret-please-only-for-tests-000000";

import { hostedAuthOptions } from "./hosted";

const FAKE_D1 = {} as Parameters<typeof hostedAuthOptions>[0];

// better-auth now types provider options (and accountLinking.trustedProviders)
// as EITHER a literal OR an awaitable factory function. hostedAuthOptions()
// always assembles plain literals, so narrow away the function form for the
// assertions below (asserting, not silently coercing — a function here would be
// a real regression).
type NonFactory<T> = Exclude<T, (...args: never[]) => unknown>;
function asValue<T>(v: T): NonFactory<T> {
  assert.equal(typeof v, "object", "expected a resolved config object, not a factory");
  return v as NonFactory<T>;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(
    Object.keys(vars).map((k) => [k, process.env[k]] as const)
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("no Google provider until BOTH secrets are set", () => {
  withEnv(
    { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined },
    () => {
      assert.equal(hostedAuthOptions(FAKE_D1).socialProviders, undefined);
    }
  );
  withEnv(
    { GOOGLE_CLIENT_ID: "id-only", GOOGLE_CLIENT_SECRET: undefined },
    () => {
      assert.equal(hostedAuthOptions(FAKE_D1).socialProviders, undefined);
    }
  );
});

test("Google provider wired from env when configured", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      PARE_SIGNUP_DISABLED: undefined,
    },
    () => {
      const raw = hostedAuthOptions(FAKE_D1).socialProviders?.google;
      assert.ok(raw, "google provider present");
      const google = asValue(raw);
      assert.equal(google.clientId, "test-client-id");
      assert.equal(google.clientSecret, "test-client-secret");
      assert.equal(google.disableSignUp, false);
    }
  );
});

test("PARE_SIGNUP_DISABLED closes the Google sign-up door too", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      PARE_SIGNUP_DISABLED: "1",
    },
    () => {
      const opts = hostedAuthOptions(FAKE_D1);
      const google = asValue(opts.socialProviders!.google!);
      assert.equal(google.disableSignUp, true);
      // Same flag, same semantics on the email door (regression guard: the two
      // gates must never drift apart).
      assert.equal(opts.emailAndPassword?.disableSignUp, true);
    }
  );
  // envFlag falsy spellings keep BOTH doors open.
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      PARE_SIGNUP_DISABLED: "false",
    },
    () => {
      const opts = hostedAuthOptions(FAKE_D1);
      const google = asValue(opts.socialProviders!.google!);
      assert.equal(google.disableSignUp, false);
      assert.equal(opts.emailAndPassword?.disableSignUp, false);
    }
  );
});

test("google is a trusted account-linking provider", () => {
  withEnv(
    {
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
    },
    () => {
      const linking = hostedAuthOptions(FAKE_D1).account?.accountLinking;
      assert.equal(linking?.enabled, true);
      const trusted = asValue(linking!.trustedProviders!);
      assert.ok(trusted.includes("google"));
    }
  );
});
