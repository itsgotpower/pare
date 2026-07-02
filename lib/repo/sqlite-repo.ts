import type Database from "better-sqlite3";
import { useConnection } from "../db";
import type { DbBackend } from "./backend";
import type {
  Repo,
  TransactionRepo,
  StatementRepo,
  CategoryRepo,
  GoalRepo,
  NetWorthRepo,
  SummaryRepo,
  IncomeRepo,
  MonthReviewRepo,
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
  ImportRepo,
} from "./types";

import {
  insertTransaction,
  insertManyTransactions,
  insertManualTransaction,
  deleteManualTransaction,
  getTransactionCategory,
  getSources,
  listTransactions,
  getCategories,
} from "../db/transactions";
import { insertStatement, listStatements } from "../db/statements";
import {
  seedCategoryRules,
  listRules,
  addRule,
  deleteRule,
  addOverride,
  removeOverride,
  recategorizeMatching,
  recategorizeAll,
  uncategorizedCount,
  ruleSuggestions,
} from "../db/categories";
import {
  listGoals,
  upsertGoal,
  deleteGoal,
  getCurrentProgress,
  getCategoryAverages,
} from "../db/goals";
import {
  listManualEntries,
  addManualEntry,
  updateManualEntry,
  deleteManualEntry,
  getNetWorth,
} from "../db/networth";
import {
  getMonthlyTotals,
  getCategoryBreakdown,
  getTrends,
  getTopMerchants,
} from "../db/summary";
import { getMonthlyIncome, getIncomeByType, getIncomeVsSpend } from "../db/income";
import { getMonthReview } from "../db/monthReview";
import { getCashflow } from "../db/cashflow";
import { getForecast } from "../db/forecast";
import { getCashflowForecast } from "../db/cashflowForecast";
import { getSubscriptions } from "../db/subscriptions";
import { getInsights } from "../db/insights";
import { getBaseline } from "../db/baseline";
import { getDailySpend } from "../db/heatmap";
import { getMerchants, getMerchantDetail } from "../db/merchants";
import { getDataHealth } from "../db/profile";
import { joinWaitlist, waitlistCount, listWaitlist } from "../db/waitlist";
import {
  createImport,
  listImports,
  deleteImport,
  getImportWatermarks,
  getImportedRowsInWindow,
} from "../db/imports";

// SqliteRepo implements the async Repo contract by delegating to the existing,
// regression-tested lib/db/* functions. better-sqlite3 is synchronous, so each
// method is a thin async wrapper — local/self-host + MCP behaviour is unchanged.
//
// The connection comes from a DbBackend, not directly from getDb(): for the
// FileBackend it IS getDb() (so the delegated functions and this class share one
// connection); for a blob backend (DoBackend), open() routes the same getDb() to
// an in-memory connection. Either way, write methods call backend.persist() so a
// blob backend can flush after a change (no-op on the file backend).
//
// Bulk writes (e.g. an upload's many inserts) go through insertMany() + batch(),
// which collapse to a SINGLE backend.persist() instead of one flush per row — on
// a blob backend that turns an O(n^2) serialise into one pass.
export class SqliteRepo implements Repo {
  private backend: DbBackend;
  private opened: Promise<Database.Database> | null = null;
  // While > 0, write() defers persistence to the enclosing batch() boundary.
  private batchDepth = 0;

  constructor(backend: DbBackend) {
    this.backend = backend;
  }

  private ready(): Promise<Database.Database> {
    // Memoize the open so concurrent first-callers share ONE open(), but clear it
    // on failure so a later call retries instead of being wedged forever behind a
    // rejected promise (the old `this.opened.then(() => open())` chain both grew
    // unboundedly per op and, if the first open() rejected, never recovered).
    // open() is idempotent and cheap once connected.
    if (!this.opened) {
      this.opened = this.backend.open().catch((err) => {
        this.opened = null;
        throw err;
      });
    }
    return this.opened;
  }

  // Re-point the process-global connection at THIS repo's db synchronously,
  // immediately before the sync query — with NO await in between — so that when
  // several per-user backends share one process (the in-process multi-user tests,
  // any future multi-DO host) a concurrent op cannot leave the global override
  // pointing at another user's db when fn() runs. On a real DO each instance owns
  // its own isolate, so this is belt-and-suspenders there.
  private async read<T>(fn: () => T): Promise<T> {
    const db = await this.ready();
    useConnection(db);
    return fn();
  }

  // Write: run the mutation, then durably persist (no-op on the file backend).
  // Inside a batch() the persist is deferred to the boundary so N writes flush once.
  private async write<T>(fn: () => T): Promise<T> {
    const db = await this.ready();
    useConnection(db);
    const result = fn();
    if (this.batchDepth === 0) await this.backend.persist(db);
    return result;
  }

  // Run several writes under ONE durability boundary: persist exactly once after
  // fn resolves. Nested batches share the outermost boundary, and we only persist
  // on success (if fn throws, nothing is flushed).
  async batch<T>(fn: () => Promise<T>): Promise<T> {
    const db = await this.ready();
    useConnection(db);
    this.batchDepth++;
    let result: T;
    try {
      result = await fn();
    } finally {
      this.batchDepth--;
    }
    if (this.batchDepth === 0) await this.backend.persist(db);
    return result;
  }

  transactions: TransactionRepo = {
    insert: (tx) => this.write(() => insertTransaction(tx)),
    insertMany: (txs) => this.write(() => insertManyTransactions(txs)),
    list: (filters) => this.read(() => listTransactions(filters)),
    categories: () => this.read(() => getCategories()),
    sources: () => this.read(() => getSources()),
    categoryOf: (id) => this.read(() => getTransactionCategory(id)),
    insertManual: (input) => this.write(() => insertManualTransaction(input)),
    deleteManual: (id) => this.write(() => deleteManualTransaction(id)),
  };

  statements: StatementRepo = {
    insert: (stmt) => this.write(() => insertStatement(stmt)),
    list: () => this.read(() => listStatements()),
  };

  categories: CategoryRepo = {
    seed: () => this.write(() => seedCategoryRules()),
    listRules: () => this.read(() => listRules()),
    addRule: (category, keyword) => this.write(() => addRule(category, keyword)),
    deleteRule: (id) => this.write(() => deleteRule(id)),
    addOverride: (transactionId, originalCategory, newCategory) =>
      this.write(() => addOverride(transactionId, originalCategory, newCategory)),
    removeOverride: (transactionId) => this.write(() => removeOverride(transactionId)),
    recategorizeMatching: (keyword, category) =>
      this.write(() => recategorizeMatching(keyword, category)),
    recategorizeAll: () => this.write(() => recategorizeAll()),
    uncategorizedCount: () => this.read(() => uncategorizedCount()),
    ruleSuggestions: () => this.read(() => ruleSuggestions()),
  };

  goals: GoalRepo = {
    list: () => this.read(() => listGoals()),
    upsert: (category, monthlyLimit) => this.write(() => upsertGoal(category, monthlyLimit)),
    delete: (id) => this.write(() => deleteGoal(id)),
    currentProgress: () => this.read(() => getCurrentProgress()),
    categoryAverages: () => this.read(() => getCategoryAverages()),
  };

  netWorth: NetWorthRepo = {
    listEntries: () => this.read(() => listManualEntries()),
    addEntry: (entry) => this.write(() => addManualEntry(entry)),
    updateEntry: (id, entry) => this.write(() => updateManualEntry(id, entry)),
    deleteEntry: (id) => this.write(() => deleteManualEntry(id)),
    get: () => this.read(() => getNetWorth()),
  };

  summary: SummaryRepo = {
    monthlyTotals: (months) => this.read(() => getMonthlyTotals(months)),
    categoryBreakdown: (month) => this.read(() => getCategoryBreakdown(month)),
    trends: () => this.read(() => getTrends()),
    topMerchants: (limit, month, category) =>
      this.read(() => getTopMerchants(limit, month, category)),
  };

  income: IncomeRepo = {
    monthly: (months) => this.read(() => getMonthlyIncome(months)),
    byType: () => this.read(() => getIncomeByType()),
    vsSpend: () => this.read(() => getIncomeVsSpend()),
  };

  monthReview: MonthReviewRepo = {
    get: (month) => this.read(() => getMonthReview(month)),
  };

  cashflow: CashflowRepo = {
    get: (month) => this.read(() => getCashflow(month)),
  };

  forecast: ForecastRepo = {
    get: (now) => this.read(() => getForecast(now)),
  };

  cashflowForecast: CashflowForecastRepo = {
    get: (now) => this.read(() => getCashflowForecast(now)),
  };

  subscriptions: SubscriptionRepo = {
    get: () => this.read(() => getSubscriptions()),
  };

  insights: InsightRepo = {
    get: () => this.read(() => getInsights()),
  };

  baseline: BaselineRepo = {
    get: (threshold) => this.read(() => getBaseline(threshold)),
  };

  heatmap: HeatmapRepo = {
    dailySpend: () => this.read(() => getDailySpend()),
  };

  merchants: MerchantRepo = {
    list: () => this.read(() => getMerchants()),
    detail: (slug) => this.read(() => getMerchantDetail(slug)),
  };

  profile: ProfileRepo = {
    dataHealth: () => this.read(() => getDataHealth()),
  };

  waitlist: WaitlistRepo = {
    join: (email, source) => this.write(() => joinWaitlist(email, source)),
    count: () => this.read(() => waitlistCount()),
    list: () => this.read(() => listWaitlist()),
  };

  imports: ImportRepo = {
    create: (rec) => this.write(() => createImport(rec)),
    list: () => this.read(() => listImports()),
    delete: (id) => this.write(() => deleteImport(id)),
    watermarks: () => this.read(() => getImportWatermarks()),
    rowsInWindow: (kind, from, to) => this.read(() => getImportedRowsInWindow(kind, from, to)),
  };
}
