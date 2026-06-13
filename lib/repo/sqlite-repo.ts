import type Database from "better-sqlite3";
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
  CashflowRepo,
  ForecastRepo,
  CashflowForecastRepo,
  SubscriptionRepo,
  InsightRepo,
  BaselineRepo,
  HeatmapRepo,
  ProfileRepo,
  WaitlistRepo,
} from "./types";

import {
  insertTransaction,
  insertManyTransactions,
  getTransactionCategory,
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
import { getCashflow } from "../db/cashflow";
import { getForecast } from "../db/forecast";
import { getCashflowForecast } from "../db/cashflowForecast";
import { getSubscriptions } from "../db/subscriptions";
import { getInsights } from "../db/insights";
import { getBaseline } from "../db/baseline";
import { getDailySpend } from "../db/heatmap";
import { getDataHealth } from "../db/profile";
import { joinWaitlist, waitlistCount } from "../db/waitlist";

// SqliteRepo implements the async Repo contract by delegating to the existing,
// regression-tested lib/db/* functions. better-sqlite3 is synchronous, so each
// method is a thin async wrapper — local/self-host + MCP behaviour is unchanged.
//
// The connection comes from a DbBackend, not directly from getDb(): for the
// FileBackend it IS getDb() (so the delegated functions and this class share one
// connection), and for the future EncryptedBlobBackend, open() routes the same
// getDb() to a decrypted in-memory connection. Either way, write methods call
// backend.persist() so the encrypted backend can flush ciphertext after a change
// (no-op on the file backend).
//
// Bulk writes (e.g. an upload's many inserts) go through insertMany() + batch(),
// which collapse to a SINGLE backend.persist() instead of one flush per row — on
// the encrypted/DO backend that turns an O(n^2) serialise+encrypt into one pass.
export class SqliteRepo implements Repo {
  private backend: DbBackend;
  private opened: Promise<Database.Database> | null = null;
  // While > 0, write() defers persistence to the enclosing batch() boundary.
  private batchDepth = 0;

  constructor(backend: DbBackend) {
    this.backend = backend;
  }

  private ready(): Promise<Database.Database> {
    // Always go through backend.open(): the file backend caches and returns its
    // singleton, while the DO backend re-asserts ITS connection as the active
    // one (useConnection) so that when multiple per-user backends share a process
    // each operation runs against the right user's DB. open() is idempotent and
    // cheap after the first call, so this stays O(1) and keeps local mode intact.
    if (!this.opened) this.opened = this.backend.open();
    else this.opened = this.opened.then(() => this.backend.open());
    return this.opened;
  }

  // Read: ensure the connection is open, then run the (sync) query.
  private async read<T>(fn: () => T): Promise<T> {
    await this.ready();
    return fn();
  }

  // Write: run the mutation, then durably persist (no-op on the file backend).
  // Inside a batch() the persist is deferred to the boundary so N writes flush once.
  private async write<T>(fn: () => T): Promise<T> {
    const db = await this.ready();
    const result = fn();
    if (this.batchDepth === 0) await this.backend.persist(db);
    return result;
  }

  // Run several writes under ONE durability boundary: persist exactly once after
  // fn resolves. Nested batches share the outermost boundary, and we only persist
  // on success (if fn throws, nothing is flushed).
  async batch<T>(fn: () => Promise<T>): Promise<T> {
    const db = await this.ready();
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
    categoryOf: (id) => this.read(() => getTransactionCategory(id)),
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
    trends: (months) => this.read(() => getTrends(months)),
    topMerchants: (limit, month, category) =>
      this.read(() => getTopMerchants(limit, month, category)),
  };

  income: IncomeRepo = {
    monthly: (months) => this.read(() => getMonthlyIncome(months)),
    byType: () => this.read(() => getIncomeByType()),
    vsSpend: () => this.read(() => getIncomeVsSpend()),
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

  profile: ProfileRepo = {
    dataHealth: () => this.read(() => getDataHealth()),
  };

  waitlist: WaitlistRepo = {
    join: (email, source) => this.write(() => joinWaitlist(email, source)),
    count: () => this.read(() => waitlistCount()),
  };
}
