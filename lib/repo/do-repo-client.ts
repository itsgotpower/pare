// DoRepoClient — the request-side Repo that forwards every call to a user's
// Durable Object (UserDataObject). getRepo() returns one of these in hosted mode,
// scoped to the authenticated userId; the route code calls it exactly like the
// local SqliteRepo, so call sites don't change.
//
// Transport is injected: `send(call)` ships a serialisable RepoMethodCall to the
// DO and resolves with the result. In production that's a DO stub RPC; in tests
// it can dispatch straight to a local Repo via callRepoMethod (proving the same
// envelope contract the DO uses). The client itself is transport-agnostic and
// carries no SQLite / native-module dependency, so it bundles into a Worker.
//
// The ~50 namespace forwarders are GENERATED from REPO_CATALOGUE (repo-rpc.ts)
// rather than hand-listed: each method becomes `(...args) => this.call(ns, m,
// ...args)`, so positional arguments ride the envelope's args array untouched.
// The catalogue's per-method read/write flag replaces the old local WRITE_METHODS
// set — one list, no drift. Type safety: the catalogue is compile-checked against
// the Repo interface in both directions (RepoCatalogue in repo-rpc.ts), and the
// merged interface below keeps `implements Repo` + fully-typed call sites; a
// method added to types.ts but not the catalogue fails to compile in repo-rpc.ts.

import type { Repo } from "./types";
import {
  REPO_CATALOGUE,
  isRepoWriteMethod,
  type AnyRepoCall,
  type RepoMethodCall,
} from "./repo-rpc";

export type RepoTransport = (call: AnyRepoCall) => Promise<unknown>;

// Declaration-merge the namespace members onto the class: the constructor loop
// provides them at runtime, this interface provides their precise Repo types.
export interface DoRepoClient extends Omit<Repo, "batch"> {}

export class DoRepoClient implements Repo {
  // While inside batch(), every WRITE issued by the closure is buffered as a
  // serialisable {namespace, method, args} call and shipped as ONE "__batch__"
  // envelope, which the DO runs under a single repo.batch() — so the whole-DB
  // serialise+persist happens exactly once regardless of how many writes. This is
  // how the batch() contract crosses the DO boundary, where the closure can't go.
  private batching = false;
  private buffer: RepoMethodCall[] = [];

  constructor(private send: RepoTransport) {
    // Build one forwarder per catalogued method. Plain objects of arrow functions
    // (not a Proxy) so the surface is enumerable/debuggable and TS needs no
    // handler gymnastics; the single cast below is the seam where the untyped
    // build loop meets the merged interface's precise types.
    const self = this as unknown as Record<
      string,
      Record<string, (...args: unknown[]) => Promise<unknown>>
    >;
    for (const [namespace, methods] of Object.entries(REPO_CATALOGUE)) {
      const forwarders: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
      for (const method of Object.keys(methods)) {
        forwarders[method] = (...args: unknown[]) => this.call(namespace, method, ...args);
      }
      self[namespace] = forwarders;
    }
  }

  private call(namespace: string, method: string, ...args: unknown[]): Promise<unknown> {
    // Inside a batch, defer writes to the batch boundary; reads still go direct.
    if (this.batching && isRepoWriteMethod(namespace, method)) {
      this.buffer.push({ namespace, method, args });
      // Placeholder — the real result is produced when the batch is shipped. The
      // sole batched caller (the upload route) reads the batch's return value,
      // not the per-write returns, so the placeholder is never observed.
      return Promise.resolve(undefined);
    }
    return this.send({ namespace, method, args });
  }

  async batch<T>(fn: () => Promise<T>): Promise<T> {
    if (this.batching) return fn(); // nested batches share the outer boundary
    this.batching = true;
    this.buffer = [];
    try {
      await fn();
    } finally {
      this.batching = false;
    }
    if (this.buffer.length === 0) return undefined as T;
    const calls = this.buffer;
    this.buffer = [];
    // Ship the buffered writes as one batch. The DO returns the FIRST write's
    // result (returnIndex 0): the sole batched caller is the upload route, whose
    // closure returns its insertMany() result (the first write) — recategorizeAll
    // runs after but its count is discarded. Buffered writes resolve to a
    // placeholder locally, so the closure's own return can't be used; returning
    // the first write's real result reproduces the route's expected batch value.
    const result = await this.send({ namespace: "__batch__", method: "exec", args: [calls, 0] });
    return result as T;
  }
}
