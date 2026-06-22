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

import type {
  Repo,
  TransactionRepo,
  StatementRepo,
  CategoryRepo,
  GoalRepo,
  NetWorthRepo,
  SummaryRepo,
  IncomeRepo,
  CashflowRepo,
  ForecastRepo,
  CashflowForecastRepo,
  SubscriptionRepo,
  InsightRepo,
  BaselineRepo,
  HeatmapRepo,
  MerchantRepo,
  ProfileRepo,
  WaitlistRepo,
  WaitlistEntry,
  InsertManyResult,
  ImportRepo,
  ImportRow,
  ImportWatermark,
  ImportedWindowRow,
} from "./types";
import type { AnyRepoCall, RepoMethodCall } from "./repo-rpc";

export type RepoTransport = (call: AnyRepoCall) => Promise<unknown>;

// Write methods are buffered while inside batch(); reads pass through. Listed
// per namespace so the proxy knows which calls to defer to the batch boundary.
const WRITE_METHODS: Record<string, ReadonlySet<string>> = {
  transactions: new Set(["insert", "insertMany"]),
  statements: new Set(["insert"]),
  categories: new Set([
    "seed",
    "addRule",
    "deleteRule",
    "addOverride",
    "removeOverride",
    "recategorizeMatching",
    "recategorizeAll",
  ]),
  goals: new Set(["upsert", "delete"]),
  netWorth: new Set(["addEntry", "updateEntry", "deleteEntry"]),
  waitlist: new Set(["join"]),
  imports: new Set(["create", "delete"]),
};

export class DoRepoClient implements Repo {
  // While inside batch(), every WRITE issued by the closure is buffered as a
  // serialisable {namespace, method, args} call and shipped as ONE "__batch__"
  // envelope, which the DO runs under a single repo.batch() — so the whole-DB
  // serialise+persist happens exactly once regardless of how many writes. This is
  // how the batch() contract crosses the DO boundary, where the closure can't go.
  private batching = false;
  private buffer: RepoMethodCall[] = [];

  constructor(private send: RepoTransport) {}

  private isWrite(namespace: string, method: string): boolean {
    return WRITE_METHODS[namespace]?.has(method) ?? false;
  }

  private call(namespace: string, method: string, ...args: unknown[]): Promise<unknown> {
    // Inside a batch, defer writes to the batch boundary; reads still go direct.
    if (this.batching && this.isWrite(namespace, method)) {
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

  transactions: TransactionRepo = {
    insert: (tx) => this.call("transactions", "insert", tx) as Promise<boolean>,
    insertMany: (txs) =>
      this.call("transactions", "insertMany", txs) as Promise<InsertManyResult>,
    list: (filters) =>
      this.call("transactions", "list", filters) as ReturnType<TransactionRepo["list"]>,
    categories: () => this.call("transactions", "categories") as Promise<string[]>,
    categoryOf: (id) =>
      this.call("transactions", "categoryOf", id) as ReturnType<TransactionRepo["categoryOf"]>,
  };

  statements: StatementRepo = {
    insert: (stmt) => this.call("statements", "insert", stmt) as Promise<number>,
    list: () => this.call("statements", "list") as ReturnType<StatementRepo["list"]>,
  };

  categories: CategoryRepo = {
    seed: () => this.call("categories", "seed") as Promise<void>,
    listRules: () => this.call("categories", "listRules") as ReturnType<CategoryRepo["listRules"]>,
    addRule: (category, keyword) =>
      this.call("categories", "addRule", category, keyword) as Promise<void>,
    deleteRule: (id) => this.call("categories", "deleteRule", id) as Promise<void>,
    addOverride: (transactionId, originalCategory, newCategory) =>
      this.call(
        "categories",
        "addOverride",
        transactionId,
        originalCategory,
        newCategory
      ) as Promise<void>,
    removeOverride: (transactionId) =>
      this.call("categories", "removeOverride", transactionId) as Promise<void>,
    recategorizeMatching: (keyword, category) =>
      this.call("categories", "recategorizeMatching", keyword, category) as Promise<number>,
    recategorizeAll: () => this.call("categories", "recategorizeAll") as Promise<number>,
    uncategorizedCount: () => this.call("categories", "uncategorizedCount") as Promise<number>,
    ruleSuggestions: () =>
      this.call("categories", "ruleSuggestions") as ReturnType<CategoryRepo["ruleSuggestions"]>,
  };

  goals: GoalRepo = {
    list: () => this.call("goals", "list") as ReturnType<GoalRepo["list"]>,
    upsert: (category, monthlyLimit) =>
      this.call("goals", "upsert", category, monthlyLimit) as Promise<void>,
    delete: (id) => this.call("goals", "delete", id) as Promise<void>,
    currentProgress: () =>
      this.call("goals", "currentProgress") as ReturnType<GoalRepo["currentProgress"]>,
    categoryAverages: () =>
      this.call("goals", "categoryAverages") as ReturnType<GoalRepo["categoryAverages"]>,
  };

  netWorth: NetWorthRepo = {
    listEntries: () =>
      this.call("netWorth", "listEntries") as ReturnType<NetWorthRepo["listEntries"]>,
    addEntry: (entry) => this.call("netWorth", "addEntry", entry) as Promise<number>,
    updateEntry: (id, entry) => this.call("netWorth", "updateEntry", id, entry) as Promise<void>,
    deleteEntry: (id) => this.call("netWorth", "deleteEntry", id) as Promise<void>,
    get: () => this.call("netWorth", "get") as ReturnType<NetWorthRepo["get"]>,
  };

  summary: SummaryRepo = {
    monthlyTotals: (months) =>
      this.call("summary", "monthlyTotals", months) as ReturnType<SummaryRepo["monthlyTotals"]>,
    categoryBreakdown: (month) =>
      this.call("summary", "categoryBreakdown", month) as ReturnType<
        SummaryRepo["categoryBreakdown"]
      >,
    trends: (months) => this.call("summary", "trends", months) as ReturnType<SummaryRepo["trends"]>,
    topMerchants: (limit, month, category) =>
      this.call("summary", "topMerchants", limit, month, category) as ReturnType<
        SummaryRepo["topMerchants"]
      >,
  };

  income: IncomeRepo = {
    monthly: (months) => this.call("income", "monthly", months) as ReturnType<IncomeRepo["monthly"]>,
    byType: () => this.call("income", "byType") as ReturnType<IncomeRepo["byType"]>,
    vsSpend: () => this.call("income", "vsSpend") as ReturnType<IncomeRepo["vsSpend"]>,
  };

  cashflow: CashflowRepo = {
    get: (month) => this.call("cashflow", "get", month) as ReturnType<CashflowRepo["get"]>,
  };

  forecast: ForecastRepo = {
    get: (now) => this.call("forecast", "get", now) as ReturnType<ForecastRepo["get"]>,
  };

  cashflowForecast: CashflowForecastRepo = {
    get: (now) =>
      this.call("cashflowForecast", "get", now) as ReturnType<CashflowForecastRepo["get"]>,
  };

  subscriptions: SubscriptionRepo = {
    get: () => this.call("subscriptions", "get") as ReturnType<SubscriptionRepo["get"]>,
  };

  insights: InsightRepo = {
    get: () => this.call("insights", "get") as ReturnType<InsightRepo["get"]>,
  };

  baseline: BaselineRepo = {
    get: (threshold) => this.call("baseline", "get", threshold) as ReturnType<BaselineRepo["get"]>,
  };

  heatmap: HeatmapRepo = {
    dailySpend: () => this.call("heatmap", "dailySpend") as ReturnType<HeatmapRepo["dailySpend"]>,
  };

  merchants: MerchantRepo = {
    list: () => this.call("merchants", "list") as ReturnType<MerchantRepo["list"]>,
    detail: (slug) => this.call("merchants", "detail", slug) as ReturnType<MerchantRepo["detail"]>,
  };

  profile: ProfileRepo = {
    dataHealth: () => this.call("profile", "dataHealth") as ReturnType<ProfileRepo["dataHealth"]>,
  };

  waitlist: WaitlistRepo = {
    join: (email, source) =>
      this.call("waitlist", "join", email, source) as ReturnType<WaitlistRepo["join"]>,
    count: () => this.call("waitlist", "count") as Promise<number>,
    list: () => this.call("waitlist", "list") as Promise<WaitlistEntry[]>,
  };

  imports: ImportRepo = {
    create: (rec) => this.call("imports", "create", rec) as Promise<number>,
    list: () => this.call("imports", "list") as Promise<ImportRow[]>,
    delete: (id) => this.call("imports", "delete", id) as Promise<{ deleted: number }>,
    watermarks: () => this.call("imports", "watermarks") as Promise<ImportWatermark[]>,
    rowsInWindow: (kind, from, to) =>
      this.call("imports", "rowsInWindow", kind, from, to) as Promise<ImportedWindowRow[]>,
  };
}
