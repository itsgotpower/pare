// Test-only Worker entry for the @cloudflare/vitest-pool-workers run that proves
// DoSqlBackend + the better-sqlite3-shaped adapter work against a REAL Durable
// Object's native SQLite storage (ctx.storage.sql), inside workerd. NOT shipped.
//
// The DO simply holds onto its ctx so the test can drive the adapter/backend/Repo
// against `ctx.storage` via runInDurableObject(). One instance per test id == one
// isolated SQLite DB, mirroring the production UserDataObject tenancy model.

import { DurableObject } from "cloudflare:workers";

export class TestSqlObject extends DurableObject {
  // The pool exposes ctx.storage (with .sql + .transactionSync) via runInDurableObject.
  async ping(): Promise<string> {
    return "ok";
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("test worker");
  },
};
