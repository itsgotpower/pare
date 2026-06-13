import { FileBackend } from "./file-backend";
import { SqliteRepo } from "./sqlite-repo";
import { DoRepoClient } from "./do-repo-client";
import { callRepoMethod, type AnyRepoCall } from "./repo-rpc";
import { isHostedMode } from "../auth/resolve";
import type { Repo } from "./types";

export * from "./types";

// ---------------------------------------------------------------------------
// getRepo — the persistence factory, now auth-scoped.
//
// Two deploy targets, selected by PARSE_DEPLOY_TARGET (lib/auth/resolve.ts):
//
//   self-hosted / local / MCP  ->  one process-wide SqliteRepo over the
//       better-sqlite3 file singleton. There is exactly one account, so there's
//       nothing to scope; `getRepo()` (no args) returns it. `npm run mcp` and
//       local dev are unchanged.
//
//   hosted  ->  one Durable Object per user. `getRepoForUser(userId)` derives the
//       user's DO from their id (USER_DATA.idFromName(userId)) and returns a
//       DoRepoClient that forwards every Repo call to THAT DO. Isolation is by
//       construction: distinct userId -> distinct DO -> distinct SQLite DB, with
//       no query that can cross between them.
//
// Routes don't call these directly — they call getScopedRepo(request, auth),
// which resolves the caller via resolveUser() and hands back their Repo (or null,
// which the route turns into 401 in hosted mode).
// ---------------------------------------------------------------------------

// The process-wide file-backed Repo for local/self-host + MCP.
let _localRepo: Repo | null = null;

export function getRepo(): Repo {
  if (!_localRepo) _localRepo = new SqliteRepo(new FileBackend());
  return _localRepo;
}

// Resolve the USER_DATA Durable Object namespace binding for the current request
// (Workers only) via the shared getBinding helper. Imported lazily so the package
// is absent in plain Node/dev. Exported so callers that already hold `env`
// (the queue consumer) can thread env.USER_DATA into getRepoForUser directly,
// rather than reaching back into getCloudflareContext() — which is not reliably
// available inside a Cloudflare queue() invocation.
export async function getUserDataNamespace(): Promise<DoNamespaceLike | null> {
  const { getBinding } = await import("../cf-bindings");
  return getBinding<DoNamespaceLike>("USER_DATA");
}

// Minimal slice of DurableObjectNamespace / stub we use — declared structurally so
// this file needs no @cloudflare/workers-types and tests can inject a stand-in.
export interface DoStubLike {
  call(req: AnyRepoCall): Promise<unknown>;
}
export interface DoNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DoStubLike;
}

// Build a Repo scoped to one user's Durable Object. The DO id is derived
// deterministically from the userId, so the same user always routes to the same
// DO (their database), and different users can NEVER share one.
export function repoOverDoStub(stub: DoStubLike): Repo {
  return new DoRepoClient((call) => stub.call(call));
}

// Resolve a per-user Repo. `ns` is the USER_DATA Durable Object namespace; it
// defaults to getUserDataNamespace() (the fetch/request path: getCloudflareContext)
// but can be passed EXPLICITLY by a caller that already holds `env` — notably the
// queue consumer, which runs in a Cloudflare queue() invocation where
// getCloudflareContext() is not reliably available, so it threads env.USER_DATA in.
export async function getRepoForUser(
  userId: string,
  ns?: DoNamespaceLike | null
): Promise<Repo> {
  const namespace = ns ?? (await getUserDataNamespace());
  if (!namespace) {
    throw new Error(
      "getRepoForUser: USER_DATA Durable Object binding unavailable (hosted mode requires the Workers runtime)"
    );
  }
  const id = namespace.idFromName(userId);
  return repoOverDoStub(namespace.get(id));
}

// In-process scoped repo used by tests (and any non-Worker hosted-mode harness):
// each userId gets its OWN SqliteRepo/backend, dispatched through the SAME
// repo-rpc envelope the real DO uses — so the test exercises the production
// routing contract, just without a Worker. `backendFor(userId)` supplies a fresh
// per-user backend (e.g. DoBackend over a per-user MemoryDurableStore).
export function inProcessRepoForUser(perUserRepo: Repo): Repo {
  return new DoRepoClient((call) => callRepoMethod(perUserRepo, call));
}

// Whether the per-request scoped path is active (hosted target).
export function isScopedMode(): boolean {
  return isHostedMode();
}
