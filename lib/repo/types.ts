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

import type { TransactionRow, TransactionFilters } from "../db/transactions";
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
import type { Cashflow } from "../db/cashflow";
import type { Forecast } from "../db/forecast";
import type { CashflowForecast } from "../db/cashflowForecast";
import type { Subscription } from "../db/subscriptions";
import type { Insight } from "../db/insights";
import type { BaselineResult } from "../db/baseline";
import type { DailySpend } from "../db/heatmap";
import type { DataHealth } from "../db/profile";
import type { WaitlistResult } from "../db/waitlist";

// Re-export the row/result types so callers can import everything from the repo
// surface without reaching into lib/db internals.
export type {
  TransactionRow,
  TransactionFilters,
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
  Cashflow,
  Forecast,
  CashflowForecast,
  Subscription,
  Insight,
  BaselineResult,
  DailySpend,
  DataHealth,
  WaitlistResult,
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
}

export interface NewStatement {
  filename: string;
  source: string;
  account: string;
  period: string;
  row_count: number;
  closing_balance?: number | null;
  closing_date?: string | null;
}

export interface ManualEntryInput {
  name: string;
  kind: "asset" | "liability";
  amount: number;
  effective_date: string;
  note?: string | null;
}

// --- Per-module namespaces -------------------------------------------------

export interface TransactionRepo {
  insert(tx: NewTransaction): Promise<boolean>;
  list(filters?: TransactionFilters): Promise<{ rows: TransactionRow[]; total: number }>;
  categories(): Promise<string[]>;
}

export interface StatementRepo {
  insert(stmt: NewStatement): Promise<number>;
  list(): Promise<StatementRow[]>;
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
}

export interface GoalRepo {
  list(): Promise<SpendingGoal[]>;
  upsert(category: string, monthlyLimit: number): Promise<void>;
  delete(id: number): Promise<void>;
  currentProgress(): Promise<GoalProgress[]>;
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
  trends(months?: number): Promise<TrendPoint[]>;
  topMerchants(limit?: number, month?: string, category?: string): Promise<TopMerchant[]>;
}

export interface IncomeRepo {
  monthly(months?: number): Promise<MonthlyIncome[]>;
  byType(): Promise<IncomeType[]>;
  vsSpend(): Promise<IncomeVsSpend[]>;
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

export interface ProfileRepo {
  dataHealth(): Promise<DataHealth>;
}

export interface WaitlistRepo {
  join(email: string, source?: string): Promise<WaitlistResult>;
  count(): Promise<number>;
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
  cashflow: CashflowRepo;
  forecast: ForecastRepo;
  cashflowForecast: CashflowForecastRepo;
  subscriptions: SubscriptionRepo;
  insights: InsightRepo;
  baseline: BaselineRepo;
  heatmap: HeatmapRepo;
  profile: ProfileRepo;
  waitlist: WaitlistRepo;
}
