import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

// End-to-end proof for the hosted auth path:
//   register -> login (cookie) -> obtain bearer token
//   -> resolveUser() returns the SAME userId for BOTH the cookie and the token.
//
// Runs without a Worker: an in-memory better-sqlite3 DB stands in for D1 via the
// same shim the dev path uses, and the better-auth instance is built directly.
// resolveUserHosted() is the production code under test (resolveUser() just
// branches to it on PARE_DEPLOY_TARGET=hosted).

process.env.BETTER_AUTH_SECRET ||= "test-secret-please-only-for-tests-000000";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
// Keep the single-user HMAC secret out of the repo's real data/ dir.
process.env.PARE_DB_PATH ||= path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "pare-auth-test-")),
  "pare.db"
);

import { createHostedAuth, type HostedAuth } from "./hosted";
import { resolveUserHosted, resolveUserSelfHosted, SINGLE_USER_ID } from "./resolve";
import { createSessionToken, SESSION_COOKIE } from "./session";

// Reuse the dev D1 shim by importing the module and pulling out makeD1Shim
// indirectly: getD1() would try the Worker context, so we replicate the shim
// build here against a known better-sqlite3 connection.
import type { D1Like } from "./hosted";

function makeD1Shim(db: Database.Database): D1Like {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...args: unknown[]) {
        params = args;
        return api;
      },
      async all() {
        const results = stmt.reader ? stmt.all(...params) : [];
        if (!stmt.reader) stmt.run(...params);
        return { results, success: true, meta: {} };
      },
      async run() {
        const info = stmt.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        };
      },
      async first(col?: string) {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? (row[col] ?? null) : row;
      },
      async raw() {
        return stmt.reader ? (stmt.raw().all(...params) as unknown[]) : [];
      },
    };
    return api;
  };
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Like;
}

let auth: HostedAuth;
let db: Database.Database;
const EMAIL = "test.user@example.com";
const PASSWORD = "correct-horse-battery-staple";

// Hosted mode requires a verified email before sign-in (lib/auth/hosted.ts).
// These tests exercise the resolveUser contract, not the verification flow, so
// they mark the address verified directly — the same end state as the user
// clicking the emailed link.
function markEmailVerified(email: string) {
  db.prepare(`UPDATE "user" SET "emailVerified" = 1 WHERE "email" = ?`).run(email);
}

before(() => {
  db = new Database(":memory:");
  // Apply the SAME auth-D1 migrations the app ships (0001 core + 0002 passkey),
  // in filename order — mirroring the dev shim (lib/auth/d1.ts) and prod's
  // `wrangler d1 migrations apply` — so the test exercises the real schema
  // rather than a hand-written copy.
  const migDir = path.join(process.cwd(), "d1/migrations");
  for (const file of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(migDir, file), "utf-8"));
  }
  auth = createHostedAuth(makeD1Shim(db));
});

test("register -> cookie login -> bearer token -> resolveUser for BOTH", async () => {
  // 1. Register (sign-up returns a session token in the set-auth-token header
  //    thanks to the bearer plugin).
  const signUp = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: "Test User" },
    returnHeaders: true,
  });
  const expectedUserId = signUp.response.user.id;
  assert.ok(expectedUserId, "sign-up returns a user id");

  // 1b. Verify the email (simulates clicking the link). Sign-in is blocked
  //     until this happens — requireEmailVerification in lib/auth/hosted.ts.
  markEmailVerified(EMAIL);

  // 2. Login with email + password. Capture BOTH the Set-Cookie header (web)
  //    and the set-auth-token header (mobile bearer).
  const login = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    returnHeaders: true,
  });
  assert.equal(login.response.user.id, expectedUserId, "login resolves same user");

  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie, "login sets a session cookie");
  const cookieHeader = setCookie!.split(";")[0]; // "better-auth.session_token=..."

  const bearerToken = login.headers.get("set-auth-token");
  assert.ok(bearerToken, "bearer plugin returns a token via set-auth-token");

  // 3a. resolveUser via the COOKIE.
  const cookieReq = new Request("http://localhost/api/transactions", {
    headers: { cookie: cookieHeader },
  });
  const viaCookie = await resolveUserHosted(cookieReq, auth);
  assert.deepEqual(viaCookie, { userId: expectedUserId }, "cookie -> correct userId");

  // 3b. resolveUser via the BEARER token (the mobile-app path).
  const bearerReq = new Request("http://localhost/api/transactions", {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  const viaBearer = await resolveUserHosted(bearerReq, auth);
  assert.deepEqual(viaBearer, { userId: expectedUserId }, "bearer -> correct userId");

  // 3c. Both auth methods agree.
  assert.equal(viaCookie!.userId, viaBearer!.userId, "cookie and bearer resolve the same user");

  // 4. No credential -> null (fails closed).
  const anon = await resolveUserHosted(new Request("http://localhost/"), auth);
  assert.equal(anon, null, "no credential -> null");

  // 5. Garbage bearer -> null.
  const bad = await resolveUserHosted(
    new Request("http://localhost/", { headers: { authorization: "Bearer nope" } }),
    auth
  );
  assert.equal(bad, null, "invalid bearer -> null");
});

test("sign-in is blocked until the email is verified", async () => {
  const email = "needs.verify@example.com";
  const password = "another-correct-horse-staple";
  await auth.api.signUpEmail({
    body: { email, password, name: "Pending User" },
  });

  // Unverified -> better-auth rejects sign-in with a 403 EMAIL_NOT_VERIFIED.
  await assert.rejects(
    auth.api.signInEmail({ body: { email, password } }),
    (err: { body?: { code?: string }; statusCode?: number }) =>
      err.body?.code === "EMAIL_NOT_VERIFIED" || err.statusCode === 403,
    "unverified sign-in should be rejected"
  );

  // After the address is verified, the same credentials sign in.
  markEmailVerified(email);
  const ok = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  assert.ok(ok.response.user.id, "verified sign-in resolves a user");
});

test("self-hosted resolver: valid HMAC cookie -> SINGLE_USER_ID, else null", async () => {
  const token = await createSessionToken();
  const ok = await resolveUserSelfHosted(
    new Request("http://localhost/", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })
  );
  assert.deepEqual(ok, { userId: SINGLE_USER_ID }, "valid cookie -> single user");

  const none = await resolveUserSelfHosted(new Request("http://localhost/"));
  assert.equal(none, null, "no cookie -> null");

  const bad = await resolveUserSelfHosted(
    new Request("http://localhost/", {
      headers: { cookie: `${SESSION_COOKIE}=garbage.token.here` },
    })
  );
  assert.equal(bad, null, "invalid cookie -> null");
});

test("password reset request does not throw and is exercisable without Resend key", async () => {
  // RESEND_API_KEY is unset in tests, so the email module logs instead of
  // sending. The point is that the better-auth -> sendResetPassword wiring is
  // valid and the endpoint succeeds.
  await assert.doesNotReject(
    auth.api.requestPasswordReset({
      body: { email: EMAIL, redirectTo: "http://localhost:3000/reset-password" },
    })
  );
});

test("passkey plugin routes are mounted and the passkey table is queryable", async () => {
  // Drive the better-auth HTTP handler the way the [...all] route does. A
  // request to the passkey authenticate-options endpoint must NOT 404 (which
  // would mean the plugin isn't mounted) — it generates options and queries the
  // `passkey` table, so a missing 0002 migration would surface as a 500 here.
  const res = await auth.handler(
    new Request(
      "http://localhost:3000/api/auth/passkey/generate-authenticate-options",
      { method: "GET" }
    )
  );
  assert.notEqual(res.status, 404, "passkey route should be mounted (not 404)");
  assert.ok(res.status < 500, `passkey route should not 500 (got ${res.status})`);
});
