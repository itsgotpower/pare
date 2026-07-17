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

// The MCP protected-resource `resource` field MUST be the canonical URI of the
// MCP SERVER (RFC 9728 §2 / MCP authorization spec) — the endpoint the client
// POSTs to, NOT the origin. The better-auth mcp plugin defaults it to
// `new URL(baseURL).origin`; that default reached prod and broke the claude.ai
// connector: the client fetched the doc named in our 401 challenge, saw
// `https://pare.money` where it expected `https://pare.money/api/mcp`, and
// silently discarded a freshly-issued token (register 201 → consent 200 →
// token 200, then zero calls to /api/mcp). This drives the REAL plugin endpoint
// through createHostedAuth, so it fails if the `resource` option is ever
// dropped from hostedAuthOptions(). The metadata endpoint reads baseURL +
// options only, so the dummy D1 is never touched.
type ProtectedResourceApi = {
  getMCPProtectedResource: (a: { asResponse: false }) => Promise<{ resource: string }>;
};

test("MCP protected-resource metadata names the /api/mcp endpoint, not the origin", async () => {
  await withEnvAsync({ BETTER_AUTH_URL: "https://pare.money" }, async () => {
    const { createHostedAuth } = await import("./hosted");
    const auth = createHostedAuth(FAKE_D1);
    const meta = await (auth.api as unknown as ProtectedResourceApi).getMCPProtectedResource({
      asResponse: false,
    });
    assert.equal(
      meta.resource,
      "https://pare.money/api/mcp",
      "resource must be the MCP server URI — on mismatch claude.ai discards the token it just obtained"
    );
  });
});

test("MCP resource tracks BETTER_AUTH_URL and tolerates a trailing slash", async () => {
  await withEnvAsync({ BETTER_AUTH_URL: "https://staging.example.com/" }, async () => {
    const { createHostedAuth } = await import("./hosted");
    const auth = createHostedAuth(FAKE_D1);
    const meta = await (auth.api as unknown as ProtectedResourceApi).getMCPProtectedResource({
      asResponse: false,
    });
    assert.equal(meta.resource, "https://staging.example.com/api/mcp");
  });
});

async function withEnvAsync(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>
) {
  const saved = new Map(
    Object.keys(vars).map((k) => [k, process.env[k]] as const)
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// MCP is OAuth 2.1, not OIDC. Advertising openid/profile/email in the
// protected-resource metadata made claude.ai request `openid` (documented
// client behavior: it requests exactly what scopes_supported lists), which
// minted an id_token the provider can't correctly sign (HS256, missing `iss`,
// while the discovery doc claimed RS256 + a dead jwks_uri) — Claude rejected
// it after a fully successful token exchange. The PRM must advertise ONLY
// offline_access; drives the real plugin endpoint like the resource tests.
test("MCP protected-resource metadata advertises only offline_access", async () => {
  await withEnvAsync({ BETTER_AUTH_URL: "https://pare.money" }, async () => {
    const { createHostedAuth } = await import("./hosted");
    const auth = createHostedAuth(FAKE_D1);
    const meta = await (
      auth.api as unknown as {
        getMCPProtectedResource: (a: { asResponse: false }) => Promise<{ scopes_supported: string[] }>;
      }
    ).getMCPProtectedResource({ asResponse: false });
    assert.deepEqual(
      meta.scopes_supported,
      ["offline_access"],
      "openid/profile/email here re-trigger the broken id_token path"
    );
  });
});

test("withScopeChallenge appends the scope hint to 401 challenges only", async () => {
  const { withScopeChallenge } = await import("./mcp-challenge");
  const c = (status: number, www?: string) =>
    new Response("x", { status, headers: www ? { "www-authenticate": www } : {} });

  const hinted = withScopeChallenge(c(401, 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"'));
  assert.equal(
    hinted.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource", scope="offline_access"'
  );
  // non-401 untouched
  assert.equal(withScopeChallenge(c(200)).headers.get("www-authenticate"), null);
  // an existing scope param is never clobbered
  const pre = withScopeChallenge(c(401, 'Bearer scope="already"'));
  assert.equal(pre.headers.get("www-authenticate"), 'Bearer scope="already"');
  // 401 without a challenge header stays bare
  assert.equal(withScopeChallenge(c(401)).headers.get("www-authenticate"), null);
});
