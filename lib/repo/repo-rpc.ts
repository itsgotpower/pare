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

// --- The method catalogue (for the request-side proxy) ---------------------
//
// Mirrors the Repo interface namespaces 1:1 (lib/repo/types.ts). DoRepoClient
// hand-lists a typed forwarder per method (do-repo-client.ts); this catalogue is
// the reference list those forwarders must cover, and feeds the DO's methods()
// probe. Kept next to the dispatcher so both sides share one source of truth.
export const REPO_NAMESPACES: Record<string, readonly string[]> = {
  transactions: ["insert", "insertMany", "list", "categories", "sources", "categoryOf"],
  statements: ["insert", "list"],
  categories: [
    "seed",
    "listRules",
    "addRule",
    "deleteRule",
    "addOverride",
    "removeOverride",
    "recategorizeMatching",
    "recategorizeAll",
    "uncategorizedCount",
    "ruleSuggestions",
  ],
  goals: ["list", "upsert", "delete", "currentProgress", "categoryAverages"],
  netWorth: ["listEntries", "addEntry", "updateEntry", "deleteEntry", "get"],
  summary: ["monthlyTotals", "categoryBreakdown", "trends", "topMerchants"],
  income: ["monthly", "byType", "vsSpend"],
  monthReview: ["get"],
  cashflow: ["get"],
  forecast: ["get"],
  cashflowForecast: ["get"],
  subscriptions: ["get"],
  insights: ["get"],
  baseline: ["get"],
  heatmap: ["dailySpend"],
  merchants: ["list", "detail"],
  profile: ["dataHealth"],
  waitlist: ["join", "count", "list"],
  imports: ["create", "list", "delete", "watermarks", "rowsInWindow"],
};

// Flat "namespace.method" list — handy for debugging / the DO's methods() probe.
export const REPO_METHODS: readonly string[] = Object.entries(REPO_NAMESPACES).flatMap(
  ([ns, methods]) => methods.map((m) => `${ns}.${m}`)
);
