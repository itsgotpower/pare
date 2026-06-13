// Test-only Worker entry for the @cloudflare/vitest-pool-workers run that proves
// DoSqlBackend + the better-sqlite3-shaped adapter work against a REAL Durable
// Object's native SQLite storage (ctx.storage.sql), inside workerd. NOT shipped.
//
// The DO simply holds onto its ctx so the test can drive the adapter/backend/Repo
// against `ctx.storage` via runInDurableObject(). One instance per test id == one
// isolated SQLite DB, mirroring the production UserDataObject tenancy model.

import { DurableObject } from "cloudflare:workers";
import { UserDataObject as UserDataImpl } from "./user-data-object";
import type { DoStorageWithSql } from "./do-sql-adapter";
import type { AnyRepoCall } from "./repo-rpc";

export class TestSqlObject extends DurableObject {
  // The pool exposes ctx.storage (with .sql + .transactionSync) via runInDurableObject.
  async ping(): Promise<string> {
    return "ok";
  }
}

// A REAL, registered Durable Object exposing the production `call` RPC over
// DoSqlBackend — mirrors worker.ts's UserDataObject. It lets the queueHandler
// regression test (lib/queue/queue-handler.workers-spec.ts) bind a true USER_DATA
// namespace and exercise the consumer's REAL dep-resolution
// (getRepoForUser(userId, env.USER_DATA) -> ns.get(id).call(...)), instead of an
// injected per-user repo. One instance per id == one isolated SQLite DB.
export class UserDataTestObject extends DurableObject {
  private impl: UserDataImpl;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.impl = new UserDataImpl(
      { storage: ctx.storage as unknown as DoStorageWithSql },
      env
    );
  }

  // The real DO stub auto-proxies this method name to the request-side
  // DoRepoClient's `stub.call(call)` transport.
  async call(req: AnyRepoCall): Promise<unknown> {
    return this.impl.call(req as never);
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("test worker");
  },
};
