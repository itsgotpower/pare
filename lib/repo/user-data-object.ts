// UserDataObject — the Durable-Object-per-user data store (hosted target).
//
// One DO instance == one user's SQLite database. The Worker routes a request to
// exactly one DO (id derived from the authenticated userId), so tenant isolation
// is BY CONSTRUCTION: there is no query that can reach another user's DO. This is
// the literal backing for the product's "your own database" claim.
//
// Internally the DO owns a SqliteRepo over a DoBackend over a DurableObjectStore
// (its own ctx.storage). DoBackend loads the whole-DB blob into an in-memory
// connection, runs MIGRATIONS at first access, and serialises back on persist().
// Every Repo method is exposed as an RPC method (callable on the DO stub from the
// Worker); DoRepoClient (lib/repo/do-repo-client.ts) is the request-side proxy
// that forwards each Repo call to these methods.
//
// NOTE on the runtime split: better-sqlite3 is a native module. The DoBackend +
// SqliteRepo path runs in Node (where this DO is exercised by the in-process /
// miniflare-storage tests). The DurableObjectStore chunked-storage layout — the
// part that must run in the Workers runtime — is proven against real DO storage
// under miniflare (see do-backend.test.ts Part 2). A production Workers build
// swaps better-sqlite3 for a WASM SQLite behind the same DoBackend seam; that is
// out of scope for this convergence step, which wires the tenancy + routing.

import { SqliteRepo } from "./sqlite-repo";
import { DoBackend } from "./do-backend";
import { DurableObjectStore, type DurableStorageLike } from "./do-store";
import type { Repo } from "./types";
import { REPO_METHODS, type RepoMethodCall, callRepoMethod } from "./repo-rpc";

// The slice of a Durable Object's `ctx`/`state` we use: just its storage. Declared
// structurally so this module needs no @cloudflare/workers-types and tests can
// pass a stand-in (the same MemoryDurableStore-style fake the storage layer uses).
export interface DurableObjectCtxLike {
  storage: DurableStorageLike;
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

  constructor(ctx: DurableObjectCtxLike, _env?: unknown) {
    // One SqliteRepo over this DO's own storage. The DoBackend opens/migrates the
    // user's DB lazily on first Repo call and persists back to ctx.storage.
    this.repo = new SqliteRepo(new DoBackend(new DurableObjectStore(ctx.storage)));
  }

  // Single RPC entry point: the Worker-side DoRepoClient sends a {namespace,
  // method, args} envelope and gets the result back. One method keeps the DO/
  // client contract tiny and avoids hand-listing ~40 methods twice. Returns are
  // structured-clone-safe (plain rows/numbers/objects), which is what DO RPC and
  // `JSON` transport both require.
  async call(req: RepoMethodCall): Promise<unknown> {
    return callRepoMethod(this.repo, req);
  }

  // Expose the method catalogue so a transport that prefers per-method RPC (real
  // DO stubs support arbitrary method names) can be generated if desired. Unused
  // by the single-entry `call` path but handy for debugging/tests.
  static methods(): readonly string[] {
    return REPO_METHODS;
  }
}
