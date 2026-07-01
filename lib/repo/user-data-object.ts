// UserDataObject — the Durable-Object-per-user data store (hosted target).
//
// One DO instance == one user's SQLite database. The Worker routes a request to
// exactly one DO (id derived from the authenticated userId), so tenant isolation
// is BY CONSTRUCTION: there is no query that can reach another user's DO. This is
// the literal backing for the product's "your own database" claim.
//
// Internally the DO owns a SqliteRepo over a DoSqlBackend (lib/repo/do-sql-backend.ts)
// over the DO's NATIVE SQLite storage (ctx.storage.sql). DoSqlBackend builds a
// better-sqlite3-shaped adapter (lib/repo/do-sql-adapter.ts) so the unchanged,
// synchronous lib/db/*.ts query layer runs directly on DO SQLite — no native
// better-sqlite3 module (which can't load on workerd) and no whole-DB blob. It runs
// MIGRATIONS at first access; writes go straight to DO storage, so persist() is a
// no-op. Every Repo method is exposed via the `call` RPC entry point; DoRepoClient
// (lib/repo/do-repo-client.ts) is the request-side proxy that forwards each Repo
// call to it.
//
// The live data path is proven against a REAL ctx.storage.sql inside workerd by
// lib/repo/do-sql-backend.workers-spec.ts (@cloudflare/vitest-pool-workers): full
// schema incl. the v_transactions VIEW, FK enforcement, the named-param adapter
// round-trip, and the Repo namespace methods over DoSqlBackend. The earlier
// blob-based DoBackend (do-backend.ts / do-store.ts) remains in tree only as
// Node-runnable test scaffolding for the Repo contract tests — it is not on the
// hosted DO path.

import { SqliteRepo } from "./sqlite-repo";
import { DoSqlBackend } from "./do-sql-backend";
import type { DoStorageWithSql } from "./do-sql-adapter";
import type { Repo } from "./types";
import { REPO_METHODS, type RepoMethodCall, callRepoMethod } from "./repo-rpc";

// The slice of a Durable Object's `ctx`/`state` we use: its storage, which must
// expose the NATIVE SQLite API (`storage.sql` + `transactionSync`). Declared
// structurally (DoStorageWithSql) so this module needs no @cloudflare/workers-types
// and tests can pass a stand-in over a real (miniflare) ctx.storage.sql.
export interface DurableObjectCtxLike {
  storage: DoStorageWithSql;
  // blockConcurrencyWhile serialises against the DO's input gate; optional so a
  // plain test ctx without it still works (calls run directly).
  blockConcurrencyWhile?<T>(fn: () => Promise<T>): Promise<T>;
}

// The DurableObject base class lives in the `cloudflare:workers` virtual module,
// which only exists in the Workers runtime / build. We don't import it at the top
// level (it would break Node + the OpenNext dev/build of the rest of the app);
// instead the class is structurally a DO (constructor(ctx, env) + RPC methods),
// and the Workers build registers it via the worker entrypoint re-export. This is
// the same "structural DO" shape OpenNext's own cache DOs compile to.

export class UserDataObject {
  private repo: Repo;
  private backend: DoSqlBackend;
  private ctx: DurableObjectCtxLike;

  constructor(ctx: DurableObjectCtxLike, _env?: unknown) {
    // One SqliteRepo over this DO's NATIVE SQLite storage. DoSqlBackend builds a
    // better-sqlite3-shaped adapter over ctx.storage.sql, runs migrations lazily on
    // first Repo call, and routes the unchanged lib/db/* query layer at it. Writes
    // go straight to DO storage (persist() is a no-op — no blob serialisation).
    this.ctx = ctx;
    this.backend = new DoSqlBackend(ctx.storage);
    this.repo = new SqliteRepo(this.backend);
  }

  // Single RPC entry point: the Worker-side DoRepoClient sends a {namespace,
  // method, args} envelope and gets the result back. One method keeps the DO/
  // client contract tiny and avoids hand-listing ~40 methods twice. Returns are
  // structured-clone-safe (plain rows/numbers/objects), which is what DO RPC and
  // `JSON` transport both require.
  async call(req: RepoMethodCall): Promise<unknown> {
    return callRepoMethod(this.repo, req);
  }

  // Hard-delete this user's entire database (account deletion). Drops every SQL
  // table/view (backend.destroy), then clears any KV-API storage. Idempotent —
  // safe to call on an already-empty DO, and the request side (destroyUserData)
  // can retry. After this the DO holds nothing and is garbage-collected.
  async destroy(): Promise<void> {
    await this.backend.destroy();
    // deleteAll() removes KV-API data only (alarms, any future settings); SQL data
    // was already dropped above. Optional on the ctx so a plain test stub without
    // it still works.
    const storage = this.ctx.storage as { deleteAll?: () => Promise<void> };
    if (typeof storage.deleteAll === "function") {
      await storage.deleteAll();
    }
  }

  // Expose the method catalogue so a transport that prefers per-method RPC (real
  // DO stubs support arbitrary method names) can be generated if desired. Unused
  // by the single-entry `call` path but handy for debugging/tests.
  static methods(): readonly string[] {
    return REPO_METHODS;
  }
}
