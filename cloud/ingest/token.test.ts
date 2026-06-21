import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { D1Like } from "@/lib/auth/hosted";
import {
  generateIngestToken,
  formatIngestAddress,
  getOrCreateIngestToken,
  rotateIngestToken,
  lookupUserByIngestToken,
  INGEST_DOMAIN,
} from "./token";

// Minimal D1Database surface over better-sqlite3 — just prepare/bind/first/run/all,
// which is all cloud/ingest/token.ts calls. Mirrors the dev shim in lib/auth/d1.ts.
function makeD1(db: Database.Database): D1Like {
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = db.prepare(sql);
    const api = {
      bind(...args: unknown[]) {
        params = args;
        return api;
      },
      async first(col?: string) {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? row[col] ?? null : row;
      },
      async run() {
        const info = stmt.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        };
      },
      async all() {
        const results = stmt.reader ? stmt.all(...params) : (stmt.run(...params), []);
        return { results, success: true, meta: {} };
      },
    };
    return api;
  };
  return { prepare } as unknown as D1Like;
}

function freshDb(): D1Like {
  const db = new Database(":memory:");
  db.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "name" TEXT, "email" TEXT)');
  db.exec(
    'CREATE TABLE "ingest_token" ("userId" TEXT NOT NULL PRIMARY KEY, "token" TEXT NOT NULL UNIQUE, "createdAt" TEXT NOT NULL)'
  );
  db.prepare("INSERT INTO \"user\" (\"id\",\"name\",\"email\") VALUES ('u1','A','a@x.com'),('u2','B','b@x.com')").run();
  return makeD1(db);
}

test("generateIngestToken: unguessable, email-safe, unique", () => {
  const a = generateIngestToken();
  const b = generateIngestToken();
  assert.notEqual(a, b);
  assert.match(a, /^[a-z2-7]+$/); // RFC4648 base32 lowercase — valid local-part
  assert.ok(a.length >= 24, `expected >=24 chars from 128 bits, got ${a.length}`);
});

test("formatIngestAddress: token @ ingest domain", () => {
  assert.equal(formatIngestAddress("abc"), `abc@${INGEST_DOMAIN}`);
});

test("getOrCreateIngestToken: creates once, then stable", async () => {
  const db = freshDb();
  const first = await getOrCreateIngestToken("u1", db);
  const second = await getOrCreateIngestToken("u1", db);
  assert.equal(first, second);
  assert.equal(await lookupUserByIngestToken(first, db), "u1");
});

test("distinct users get distinct tokens", async () => {
  const db = freshDb();
  const t1 = await getOrCreateIngestToken("u1", db);
  const t2 = await getOrCreateIngestToken("u2", db);
  assert.notEqual(t1, t2);
  assert.equal(await lookupUserByIngestToken(t1, db), "u1");
  assert.equal(await lookupUserByIngestToken(t2, db), "u2");
});

test("rotateIngestToken: old address dies, new one resolves", async () => {
  const db = freshDb();
  const old = await getOrCreateIngestToken("u1", db);
  const next = await rotateIngestToken("u1", db);
  assert.notEqual(old, next);
  assert.equal(await lookupUserByIngestToken(old, db), null);
  assert.equal(await lookupUserByIngestToken(next, db), "u1");
  // get-or-create now returns the rotated token, not a third one.
  assert.equal(await getOrCreateIngestToken("u1", db), next);
});

test("lookupUserByIngestToken: unknown/empty -> null", async () => {
  const db = freshDb();
  assert.equal(await lookupUserByIngestToken("nope", db), null);
  assert.equal(await lookupUserByIngestToken("", db), null);
});
