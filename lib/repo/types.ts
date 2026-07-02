// The async Repo interface — the persistence contract shared by both deploy
// targets. Local/self-host + MCP use SqliteRepo over a live better-sqlite3 file;
// the hosted (Cloudflare DO-per-user) target will implement the same interface
// over Durable Object storage. better-sqlite3 is synchronous, so SqliteRepo's
// methods are thin async wrappers — local behaviour is unchanged.
//
// Namespaces mirror today's lib/db/*.ts modules 1:1 so the route migration is
// mechanical: `import { listTransactions } from "lib/db/transactions"` becomes
// `await repo.transactions.list(...)`.
//
// Pure helpers with no DB access (computeDedupKey, categorizeByRules) stay where
// they are — they are not part of this contract.

import type {
  TransactionRow,
  TransactionFilters,
  ManualTransactionInput,
} from "../db/transactions";
import type { StatementRow } from "../db/statements";
import type { CategoryRule } from "../db/categories";
import type { SpendingGoal, GoalProgress } from "../db/goals";
import type { ManualEntry, NetWorthData } from "../db/networth";
import type {
  MonthlyTotal,
  CategoryBreakdown,
  TrendPoint,
  TopMerchant,
} from "../db/summary";
import type { MonthlyIncome, IncomeType, IncomeVsSpend } from "../db/income";
import type { MonthReview } from "../db/monthReview";
import type { Cashflow } from "../db/cashflow";
import type { Forecast } from "../db/forecast";
import type { CashflowForecast } from "../db/cashflowForecast";
import type { Subscription } from "../db/subscriptions";
import type { Insight } from "../db/insights";
import type { BaselineResult } from "../db/baseline";
import type { DailySpend } from "../db/heatmap";
import type {
  MerchantSummary,
  MerchantDetail,
} from "../db/merchants";
import type { DataHealth } from "../db/profile";
import type { WaitlistResult, WaitlistEntry } from "../db/waitlist";
import type {
  ImportRow,
  ImportWatermark,
  ImportedWindowRow,
} from "../db/imports";

// Re-export the row/result types so callers can import everything from the repo
// surface without reaching into lib/db internals.
export type {
  TransactionRow,
  TransactionFilters,
  ManualTransactionInput,
  StatementRow,
  CategoryRule,
  SpendingGoal,
  GoalProgress,
  ManualEntry,
  NetWorthData,
  MonthlyTotal,
  CategoryBreakdown,
  TrendPoint,
  TopMerchant,
  MonthlyIncome,
  IncomeType,
  IncomeVsSpend,
  MonthReview,
  Cashflow,
  Forecast,
  CashflowForecast,
  Subscription,
  Insight,
  BaselineResult,
  DailySpend,
  MerchantSummary,
  MerchantDetail,
  DataHealth,
  WaitlistResult,
  WaitlistEntry,
  ImportRow,
  ImportWatermark,
  ImportedWindowRow,
};

// --- Write input shapes (today these are inline param types) ---------------

export interface NewTransaction {
  statement_id: number | null;
  source: string;
  account: string;
  period: string;
  txn_date: string;
  description: string;
  amount: number;
  category: string;
  flow: string;
  dedup_key: string;
  // Analytics-facing account class (see lib/db/account-kinds.ts). Optional at the
  // type level so existing callers compile; the insert layer defaults a missing
  // value to 'unknown'. insertParsedStatement derives it from `source`.
  account_kind?: string;
  // Set ONLY by the importer (lib/repo/insert-imported.ts) to tag a row's
  // provenance for one-click undo; null/absent for PDF-parsed rows.
  import_id?: number | null;
}

export interface NewStatement {
  filename: string;
  source: string;
  account: string;
  period: string;
  row_count: number;
  closing_balance?: number | null;
  closing_date?: string | null;
  account_kind?: string;
}

export interface ManualEntryInput {
  name: string;
  kind: "asset" | "liability";
  amount: number;
  effective_date: string;
  note?: string | null;
}

// --- Per-module namespaces -------------------------------------------------

// Result of a batched insert: how many rows were newly written vs. skipped as
// duplicates (INSERT OR IGNORE on the dedup_key).
export interface InsertManyResult {
  inserted: number;
  skipped: number;
}

// One row's current category — used by the override route to record the
// before-value when a manual override is applied.
export interface TransactionCategory {
  category: string;
}

export interface TransactionRepo {
  insert(tx: NewTransaction): Promise<boolean>;
  // Insert many rows under a SINGLE DB transaction (one persist on backends that
  // serialise+encrypt on every write — avoids the O(n^2) per-row flush). Returns
  // newly-inserted vs. skipped-as-duplicate counts.
  insertMany(txs: NewTransaction[]): Promise<InsertManyResult>;
  list(filters?: TransactionFilters): Promise<{ rows: TransactionRow[]; total: number }>;
  categories(): Promise<string[]>;
  // Distinct sources with rows — the transactions page's source-filter options.
  sources(): Promise<string[]>;
  // The current stored category for one row, or null if it doesn't exist.
  categoryOf(id: number): Promise<TransactionCategory | null>;
  // Record a cash purchase made outside any statement (quick-add). The user's
  // category pick is stored as an override so recategorize passes keep it.
  insertManual(input: ManualTransactionInput): Promise<{ id: number }>;
  // Delete a quick-added row (and its override). Statement-backed rows are
  // refused — deleted: 0.
  deleteManual(id: number): Promise<{ deleted: number }>;
}

export interface StatementRepo {
  insert(stmt: NewStatement): Promise<number>;
  list(): Promise<StatementRow[]>;
}

// A keyword→category rule suggestion mined from manual overrides, plus how many
// existing rows the keyword would (re)tag.
export interface RuleSuggestion {
  keyword: string;
  category: string;
  count: number;
}

export interface CategoryRepo {
  seed(): Promise<void>;
  listRules(): Promise<CategoryRule[]>;
  addRule(category: string, keyword: string): Promise<void>;
  deleteRule(id: number): Promise<void>;
  addOverride(transactionId: number, originalCategory: string, newCategory: string): Promise<void>;
  removeOverride(transactionId: number): Promise<void>;
  recategorizeMatching(keyword: string, category: string): Promise<number>;
  recategorizeAll(): Promise<number>;
  // Count of card-spend rows still in 'Other / uncategorized'.
  uncategorizedCount(): Promise<number>;
  // Rule suggestions derived from recorded manual overrides.
  ruleSuggestions(): Promise<RuleSuggestion[]>;
}

// A category's average monthly card spend over the data window — the basis for
// suggested goal limits.
export interface CategoryAverage {
  category: string;
  avg_monthly: number;
}

export interface GoalRepo {
  list(): Promise<SpendingGoal[]>;
  upsert(category: string, monthlyLimit: number): Promise<void>;
  delete(id: number): Promise<void>;
  currentProgress(): Promise<GoalProgress[]>;
  // Per-category average monthly card spend (suggested-limit source).
  categoryAverages(): Promise<CategoryAverage[]>;
}

export interface NetWorthRepo {
  listEntries(): Promise<ManualEntry[]>;
  addEntry(entry: ManualEntryInput): Promise<number>;
  updateEntry(id: number, entry: ManualEntryInput): Promise<void>;
  deleteEntry(id: number): Promise<void>;
  get(): Promise<NetWorthData>;
}

export interface SummaryRepo {
  monthlyTotals(months?: number): Promise<MonthlyTotal[]>;
  categoryBreakdown(month?: string): Promise<CategoryBreakdown[]>;
  trends(): Promise<TrendPoint[]>;
  topMerchants(limit?: number, month?: string, category?: string): Promise<TopMerchant[]>;
}

export interface IncomeRepo {
  monthly(months?: number): Promise<MonthlyIncome[]>;
  byType(): Promise<IncomeType[]>;
  vsSpend(): Promise<IncomeVsSpend[]>;
}

export interface MonthReviewRepo {
  get(month?: string): Promise<MonthReview>;
}

export interface CashflowRepo {
  get(month?: string): Promise<Cashflow>;
}

export interface ForecastRepo {
  get(now?: Date): Promise<Forecast | null>;
}

export interface CashflowForecastRepo {
  get(now?: Date): Promise<CashflowForecast | null>;
}

export interface SubscriptionRepo {
  get(): Promise<{ subscriptions: Subscription[]; monthlyTotal: number }>;
}

export interface InsightRepo {
  get(): Promise<Insight[]>;
}

export interface BaselineRepo {
  get(threshold?: number): Promise<BaselineResult>;
}

export interface HeatmapRepo {
  dailySpend(): Promise<DailySpend[]>;
}

export interface MerchantRepo {
  // The merchant index (all card-spend merchants, biggest first).
  list(): Promise<MerchantSummary[]>;
  // One merchant's full history by slug, or null if it matches no spend.
  detail(slug: string): Promise<MerchantDetail | null>;
}

export interface ProfileRepo {
  dataHealth(): Promise<DataHealth>;
}

export interface WaitlistRepo {
  join(email: string, source?: string): Promise<WaitlistResult>;
  count(): Promise<number>;
  list(): Promise<WaitlistEntry[]>;
}

// Provenance + rollback for cross-app imports (lib/db/imports.ts). `create` and
// `delete` are writes; the rest are reads (watermarks/window feed the overlap
// guard).
export interface ImportRepo {
  create(rec: {
    provider: string;
    row_count: number;
    account_map: string;
    date_min: string | null;
    date_max: string | null;
  }): Promise<number>;
  list(): Promise<ImportRow[]>;
  delete(id: number): Promise<{ deleted: number }>;
  watermarks(): Promise<ImportWatermark[]>;
  rowsInWindow(accountKind: string, fromDate: string, toDate: string): Promise<ImportedWindowRow[]>;
}

// --- The aggregate contract ------------------------------------------------

export interface Repo {
  transactions: TransactionRepo;
  statements: StatementRepo;
  categories: CategoryRepo;
  goals: GoalRepo;
  netWorth: NetWorthRepo;
  summary: SummaryRepo;
  income: IncomeRepo;
  monthReview: MonthReviewRepo;
  cashflow: CashflowRepo;
  forecast: ForecastRepo;
  cashflowForecast: CashflowForecastRepo;
  subscriptions: SubscriptionRepo;
  insights: InsightRepo;
  baseline: BaselineRepo;
  heatmap: HeatmapRepo;
  merchants: MerchantRepo;
  profile: ProfileRepo;
  waitlist: WaitlistRepo;
  imports: ImportRepo;

  // Group several writes into ONE durability boundary. Every write issued by `fn`
  // runs against the open connection, and the backend persists exactly once after
  // `fn` resolves (instead of once per write). On the file backend persist() is a
  // no-op so this is purely a batching hint; on the encrypted/DO backend it turns
  // an upload's per-row serialise+encrypt (O(n^2)) into a single flush.
  batch<T>(fn: () => Promise<T>): Promise<T>;
}
