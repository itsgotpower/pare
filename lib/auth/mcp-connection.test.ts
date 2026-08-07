import { test } from "node:test";
import assert from "node:assert/strict";
import { getMcpConnection, revokeMcpConnection } from "./mcp-connection";
import type { D1Like } from "./hosted";

// Fake D1: ignores the SQL and hands back canned rows, so the tests exercise the
// connected/expiry LOGIC (the risky part), not SQLite. Mirrors the real
// prepare().bind().all() shape getMcpConnection depends on.
function fakeDb(rows: unknown[]): D1Like {
  const stmt = {
    bind() {
      return stmt;
    },
    async all() {
      return { results: rows, success: true, meta: {} };
    },
  };
  return { prepare: () => stmt } as unknown as D1Like;
}

const NOW = Date.parse("2026-07-18T00:00:00Z");
const future = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const past = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

test("no token rows → disconnected", async () => {
  const s = await getMcpConnection(fakeDb([]), "u1", NOW);
  assert.equal(s.connected, false);
  assert.equal(s.connectedAt, null);
  assert.equal(s.clientName, null);
});

test("live refresh token → connected, with client name + connected-since", async () => {
  const s = await getMcpConnection(
    fakeDb([
      {
        accessTokenExpiresAt: past(1), // access expired…
        refreshTokenExpiresAt: future(30), // …but refresh is alive
        createdAt: "2026-07-10T12:00:00Z",
        clientName: "Claude",
      },
    ]),
    "u1",
    NOW
  );
  assert.equal(s.connected, true);
  assert.equal(s.clientName, "Claude");
  assert.equal(s.connectedAt, "2026-07-10T12:00:00.000Z");
});

test("expired refresh token → disconnected", async () => {
  const s = await getMcpConnection(
    fakeDb([
      {
        accessTokenExpiresAt: past(2),
        refreshTokenExpiresAt: past(1),
        createdAt: "2026-06-01T00:00:00Z",
        clientName: "Claude",
      },
    ]),
    "u1",
    NOW
  );
  assert.equal(s.connected, false);
});

test("no refresh expiry → falls back to access-token expiry", async () => {
  const alive = await getMcpConnection(
    fakeDb([{ accessTokenExpiresAt: future(1), refreshTokenExpiresAt: null, createdAt: past(1), clientName: null }]),
    "u1",
    NOW
  );
  assert.equal(alive.connected, true);
  assert.equal(alive.clientName, null); // DCR client with no registered name

  const dead = await getMcpConnection(
    fakeDb([{ accessTokenExpiresAt: null, refreshTokenExpiresAt: null, createdAt: past(1), clientName: null }]),
    "u1",
    NOW
  );
  assert.equal(dead.connected, false);
});

test("multiple live tokens → connectedAt is the earliest", async () => {
  const s = await getMcpConnection(
    fakeDb([
      { accessTokenExpiresAt: future(1), refreshTokenExpiresAt: future(30), createdAt: "2026-07-15T00:00:00Z", clientName: null },
      { accessTokenExpiresAt: future(1), refreshTokenExpiresAt: future(30), createdAt: "2026-07-11T00:00:00Z", clientName: "Claude" },
    ]),
    "u1",
    NOW
  );
  assert.equal(s.connected, true);
  assert.equal(s.connectedAt, "2026-07-11T00:00:00.000Z");
  assert.equal(s.clientName, "Claude");
});

test("numeric epoch-ms expiry is honored (adapter-format robustness)", async () => {
  const s = await getMcpConnection(
    fakeDb([{ accessTokenExpiresAt: NOW + 86_400_000, refreshTokenExpiresAt: NOW + 30 * 86_400_000, createdAt: NOW - 86_400_000, clientName: "Claude" }]),
    "u1",
    NOW
  );
  assert.equal(s.connected, true);
});

test("revokeMcpConnection deletes tokens + consent, scoped to the user", async () => {
  const executed: string[] = [];
  const bound: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          bound.push(args);
          return {
            async run() {
              executed.push(sql);
              // D1 shape: affected rows on meta.changes.
              return sql.includes("oauthAccessToken")
                ? { success: true, meta: { changes: 2 } }
                : { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Like;

  const res = await revokeMcpConnection(db, "u1");
  assert.equal(res.revokedTokens, 2, "reports the token-row count, not consent's");
  assert.equal(executed.length, 2);
  assert.match(executed[0], /DELETE FROM "oauthAccessToken" WHERE "userId" = \?/);
  assert.match(executed[1], /DELETE FROM "oauthConsent" WHERE "userId" = \?/);
  assert.deepEqual(bound, [["u1"], ["u1"]], "both deletes bind the user id");
});

test("revokeMcpConnection tolerates a driver without meta.changes", async () => {
  const db = {
    prepare() {
      return { bind: () => ({ run: async () => ({ success: true }) }) };
    },
  } as unknown as D1Like;
  const res = await revokeMcpConnection(db, "u1");
  assert.equal(res.revokedTokens, 0);
});
