// The Repo-over-RPC contract shared by UserDataObject (DO side, executes against
// the user's SQLite) and DoRepoClient (request side, forwards to the DO stub).
//
// The Repo surface is large and async; rather than hand-list every method on both
// sides (and risk drift), both sides share ONE dispatch table here. A call is a
// plain, structured-clone-safe envelope: { namespace, method, args }. The DO runs
// callRepoMethod(repo, call); the client builds the call and ships it.
//
// batch() is special: its argument is a closure, which cannot cross an RPC/DO
// boundary. Instead the client serialises the batched writes into a generic
// "__batch__" envelope (RepoBatchCall below) — a list of sub-calls the DO runs
// under ONE durability boundary via repo.batch().

import type { Repo } from "./types";

// --- The serialisable call envelope ----------------------------------------

export interface RepoMethodCall {
  namespace: string;
  method: string;
  args: unknown[];
}

// A batch: a serialisable list of writes the DO runs under ONE durability
// boundary (repo.batch), so the whole-DB serialise+persist happens exactly once
// no matter how many rows/writes it contains. This is how DoRepoClient honours
// the batch() contract across the DO boundary, where the closure itself can't go.
// `returnIndex` selects which sub-call's result becomes the batch's return value
// (-1 = the last write, matching how the upload route reads its batch result).
export interface RepoBatchCall {
  namespace: "__batch__";
  method: "exec";
  args: [RepoMethodCall[], number];
}

export type AnyRepoCall = RepoMethodCall | RepoBatchCall;

function isBatchCall(call: AnyRepoCall): call is RepoBatchCall {
  return call.namespace === "__batch__" && call.method === "exec";
}

// --- Dispatch on the DO side -----------------------------------------------

function invoke(repo: Repo, namespace: string, method: string, args: unknown[]): unknown {
  const ns = (repo as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
    namespace
  ];
  if (!ns) throw new Error(`repo-rpc: unknown namespace "${namespace}"`);
  const fn = ns[method];
  if (typeof fn !== "function") {
    throw new Error(`repo-rpc: unknown method "${namespace}.${method}"`);
  }
  return fn.apply(ns, args);
}

// Execute a call (single or batch) against a concrete Repo. Used by
// UserDataObject; also by the in-process test path (no real DO, just a Repo).
export async function callRepoMethod(repo: Repo, call: AnyRepoCall): Promise<unknown> {
  if (isBatchCall(call)) {
    const [calls, returnIndex] = call.args;
    return repo.batch(async () => {
      const results: unknown[] = [];
      for (const c of calls) results.push(await invoke(repo, c.namespace, c.method, c.args));
      const idx = returnIndex < 0 ? results.length + returnIndex : returnIndex;
      return results[idx];
    });
  }
  return invoke(repo, call.namespace, call.method, call.args);
}

// --- The method catalogue (drives the request-side proxy) ------------------
//
// ONE catalogue for the whole RPC surface: DoRepoClient GENERATES its forwarders
// from it (do-repo-client.ts), and each method's read/write flag is what batch()
// uses to decide buffering — so the method list and the write list cannot drift.
//
// The RepoCatalogue mapped type pins it to the Repo interface (lib/repo/types.ts)
// in BOTH directions at compile time: a method added to types.ts but missing here
// is a "property missing" error, and a catalogued name that doesn't exist on Repo
// is an excess-property error. Kept next to the dispatcher so both sides share
// one source of truth.

// "write" methods are buffered while inside DoRepoClient.batch(); "read" methods
// always pass straight through to the transport.
type MethodKind = "read" | "write";

type RepoSurface = Omit<Repo, "batch">;
export type RepoCatalogue = {
  readonly [N in keyof RepoSurface]: { readonly [M in keyof RepoSurface[N]]: MethodKind };
};

export const REPO_CATALOGUE: RepoCatalogue = {
  transactions: {
    insert: "write",
    insertMany: "write",
    list: "read",
    categories: "read",
    sources: "read",
    categoryOf: "read",
    insertManual: "write",
    deleteManual: "write",
  },
  statements: { insert: "write", list: "read" },
  categories: {
    seed: "write",
    listRules: "read",
    addRule: "write",
    deleteRule: "write",
    addOverride: "write",
    removeOverride: "write",
    recategorizeMatching: "write",
    recategorizeAll: "write",
    uncategorizedCount: "read",
    ruleSuggestions: "read",
  },
  goals: {
    list: "read",
    upsert: "write",
    delete: "write",
    currentProgress: "read",
    categoryAverages: "read",
  },
  netWorth: {
    listEntries: "read",
    addEntry: "write",
    updateEntry: "write",
    deleteEntry: "write",
    get: "read",
  },
  summary: { monthlyTotals: "read", categoryBreakdown: "read", trends: "read", topMerchants: "read" },
  income: { monthly: "read", byType: "read", vsSpend: "read" },
  monthReview: { get: "read" },
  cashflow: { get: "read" },
  forecast: { get: "read" },
  cashflowForecast: { get: "read" },
  subscriptions: { get: "read" },
  insights: { get: "read" },
  baseline: { get: "read" },
  heatmap: { dailySpend: "read" },
  merchants: { list: "read", detail: "read" },
  profile: { dataHealth: "read" },
  waitlist: { join: "write", count: "read", list: "read" },
  imports: { create: "write", list: "read", delete: "write", watermarks: "read", rowsInWindow: "read" },
};

// True for methods DoRepoClient.batch() must buffer (see MethodKind above).
export function isRepoWriteMethod(namespace: string, method: string): boolean {
  const ns = (REPO_CATALOGUE as Record<string, Record<string, MethodKind> | undefined>)[namespace];
  return ns?.[method] === "write";
}

// Namespace → method-name list, derived from the catalogue (kept for callers
// that only need names).
export const REPO_NAMESPACES: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(REPO_CATALOGUE).map(([ns, methods]) => [ns, Object.keys(methods)])
);

// Flat "namespace.method" list — handy for debugging / the DO's methods() probe.
export const REPO_METHODS: readonly string[] = Object.entries(REPO_NAMESPACES).flatMap(
  ([ns, methods]) => methods.map((m) => `${ns}.${m}`)
);
