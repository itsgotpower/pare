"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { merchantSlug } from "@/lib/merchant-key";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { DailySpend } from "@/components/dashboard/calendar-heatmap";
import { MonthReview } from "@/components/dashboard/month-review";
import { NetWorthTab, type NetWorth } from "@/components/dashboard/networth-tab";
import { ForecastTab, type CashflowForecast } from "@/components/dashboard/forecast-tab";
import { SafeToSpendHero } from "@/components/dashboard/safe-to-spend";
import { BaselineTab } from "@/components/dashboard/baseline-tab";
import { CashflowTab, type Forecast } from "@/components/dashboard/cashflow-tab";
import type { Cashflow } from "@/components/dashboard/cashflow-sankey";
import {
  IncomeTab,
  type IncomeType,
  type IncomeVsSpend,
} from "@/components/dashboard/income-tab";
import { categoryColor, PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatMonthShort,
  formatMonthFull,
  formatK,
  CHART_TOOLTIP_STYLE,
  MONO_TICK,
} from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface MonthlyTotal {
  month: string;
  total: number;
}

interface CategoryBreakdown {
  category: string;
  total: number;
  count: number;
}

interface TopMerchant {
  description: string;
  total: number;
  count: number;
}

interface GoalProgress {
  category: string;
  monthly_limit: number;
  spent: number;
  remaining: number;
  percentage: number;
}

interface Insight {
  severity: "alert" | "warn" | "good" | "info";
  title: string;
  detail: string;
  category?: string;
}

interface TrendPoint {
  month: string;
  category: string;
  total: number;
}

const SEVERITY_COLORS: Record<Insight["severity"], string> = {
  alert: PALETTE.terracotta,
  warn: PALETTE.mustard,
  good: PALETTE.sage,
  info: PALETTE.dustyblue,
};

export default function Dashboard() {
  const [monthly, setMonthly] = useState<MonthlyTotal[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [merchants, setMerchants] = useState<TopMerchant[]>([]);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [incomeByType, setIncomeByType] = useState<IncomeType[]>([]);
  const [incomeVsSpend, setIncomeVsSpend] = useState<IncomeVsSpend[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [dailySpend, setDailySpend] = useState<DailySpend[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorth | null>(null);
  const [cashForecast, setCashForecast] = useState<CashflowForecast | null>(null);
  // Touch devices have no hover — switch every chart tooltip to tap.
  const [coarsePointer, setCoarsePointer] = useState(false);
  const allMerchantsRef = useRef<TopMerchant[]>([]);

  useEffect(() => {
    setCoarsePointer(window.matchMedia("(hover: none)").matches);
  }, []);

  const loadAll = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/summary?type=all")
      .then(async (r) => {
        if (!r.ok) throw new Error(`request failed (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setMonthly((data.monthly_totals || []).reverse());
        setCategories(data.category_breakdown || []);
        const m = data.top_merchants || [];
        setMerchants(m);
        allMerchantsRef.current = m;
        setGoals(data.goals || []);
        setTrends(data.trends || []);
        setIncomeByType(data.income_by_type || []);
        setIncomeVsSpend(data.income_vs_spend || []);
        setInsights(data.insights || []);
        setCashflow(data.cashflow || null);
        setForecast(data.forecast || null);
        setDailySpend(data.daily_spend || []);
        setNetWorth(data.net_worth || null);
        setCashForecast(data.cashflow_forecast || null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "request failed");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const fetchFilteredMerchants = useCallback(() => {
    if (!selectedMonth && !selectedCategory) {
      setMerchants(allMerchantsRef.current);
      return;
    }
    const p = new URLSearchParams({ type: "top_merchants" });
    if (selectedMonth) p.set("month", selectedMonth);
    if (selectedCategory) p.set("category", selectedCategory);
    fetch(`/api/summary?${p}`)
      .then((r) => r.json())
      .then(setMerchants);
  }, [selectedMonth, selectedCategory]);

  useEffect(() => {
    if (loading) return;
    fetchFilteredMerchants();
  }, [fetchFilteredMerchants, loading]);

  const displayMonthly = selectedCategory
    ? monthly.map((m) => {
        const t = trends.find(
          (tr) => tr.month === m.month && tr.category === selectedCategory
        );
        return { month: m.month, total: t?.total || 0 };
      })
    : monthly;

  const displayCategories = selectedMonth
    ? trends
        .filter((t) => t.month === selectedMonth)
        .map((t) => ({ category: t.category, total: t.total, count: 0 }))
        .sort((a, b) => b.total - a.total)
    : categories;

  const displayCategoryTotal = displayCategories.reduce((s, c) => s + c.total, 0);

  const displayTotal = selectedMonth && selectedCategory
    ? (trends.find((t) => t.month === selectedMonth && t.category === selectedCategory)?.total || 0)
    : selectedMonth
    ? displayCategoryTotal
    : displayMonthly.reduce((s, m) => s + m.total, 0);
  const displayMonthsActive = displayMonthly.filter((m) => m.total > 0).length;
  const displayAvg = displayMonthsActive ? displayMonthly.reduce((s, m) => s + m.total, 0) / displayMonthsActive : 0;

  const filterLabel = selectedMonth && selectedCategory
    ? `${selectedCategory.toUpperCase()} IN ${formatMonthFull(selectedMonth).toUpperCase()}`
    : selectedMonth
    ? formatMonthFull(selectedMonth).toUpperCase()
    : selectedCategory
    ? selectedCategory.toUpperCase()
    : null;

  const totalSpend = monthly.reduce((sum, m) => sum + m.total, 0);
  const hasData = monthly.length > 0;

  const tooltipTrigger = coarsePointer ? ("click" as const) : ("hover" as const);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
          DASHBOARD
        </h1>
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground mb-4">
              COULDN&apos;T LOAD DASHBOARD — {error.toUpperCase()}
            </p>
            <Button
              onClick={loadAll}
              className="font-mono text-xs tracking-widest uppercase"
            >
              RETRY
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
        DASHBOARD
      </h1>

      {!hasData ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-4 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              NO DATA YET — IMPORT A STATEMENT TO GET STARTED
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase hover:bg-foreground hover:text-background transition-colors"
            >
              Upload statements →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
        <SafeToSpendHero cashForecast={cashForecast} />
        {insights.length > 0 && (
          <div className="mb-6 border border-border">
            <button
              onClick={() => setInsightsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
              aria-expanded={insightsOpen}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
                  INSIGHTS
                </span>
                <span className="flex items-center gap-1">
                  {insights.slice(0, 6).map((ins, i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5"
                      style={{ backgroundColor: SEVERITY_COLORS[ins.severity] }}
                    />
                  ))}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.min(insights.length, 6)}
                </span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {insightsOpen ? "−" : "+"}
              </span>
            </button>
            {insightsOpen && (
              <div className="divide-y divide-border border-t border-border">
                {insights.slice(0, 6).map((ins, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className="mt-1 w-2 h-2 shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[ins.severity] }}
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-sm">{ins.title}</p>
                      <p className="text-xs text-muted-foreground">{ins.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <Tabs defaultValue="overview">
          {/* Eight tabs don't fit a phone — let the strip scroll sideways.
              pb gives the active-tab underline (bottom:-5px) room to render. */}
          <div className="mb-4 -mx-4 px-4 pb-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:px-0">
            <TabsList variant="line">
            <TabsTrigger value="overview" className="font-mono text-xs tracking-widest">
              OVERVIEW
            </TabsTrigger>
            <TabsTrigger value="review" className="font-mono text-xs tracking-widest">
              REVIEW
            </TabsTrigger>
            <TabsTrigger value="categories" className="font-mono text-xs tracking-widest">
              BY CATEGORY
            </TabsTrigger>
            <TabsTrigger value="income" className="font-mono text-xs tracking-widest">
              INCOME
            </TabsTrigger>
            <TabsTrigger value="cashflow" className="font-mono text-xs tracking-widest">
              CASHFLOW
            </TabsTrigger>
            <TabsTrigger value="forecast" className="font-mono text-xs tracking-widest">
              FORECAST
            </TabsTrigger>
            <TabsTrigger value="networth" className="font-mono text-xs tracking-widest">
              NET WORTH
            </TabsTrigger>
            <TabsTrigger value="baseline" className="font-mono text-xs tracking-widest">
              BASELINE
            </TabsTrigger>
          </TabsList>
          </div>

          <TabsContent value="review">
            <MonthReview />
          </TabsContent>

          <TabsContent value="overview">
        {filterLabel && (
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">SHOWING</span>
            {selectedMonth && (
              <button
                onClick={() => setSelectedMonth(null)}
                className="inline-flex items-center gap-1.5 border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-accent"
              >
                {formatMonthFull(selectedMonth).toUpperCase()}
                <span className="text-muted-foreground">×</span>
              </button>
            )}
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory(null)}
                className="inline-flex items-center gap-1.5 border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest hover:bg-accent"
              >
                <span
                  className="inline-block w-2 h-2"
                  style={{ backgroundColor: categoryColor(selectedCategory) }}
                />
                {selectedCategory.toUpperCase()}
                <span className="text-muted-foreground">×</span>
              </button>
            )}
            <button
              onClick={() => { setSelectedMonth(null); setSelectedCategory(null); }}
              className="font-mono text-[10px] tracking-widest text-muted-foreground hover:text-foreground ml-auto"
            >
              CLEAR ALL
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
          {/* Monthly Spend — 2 cols */}
          <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              MONTHLY SPEND
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={displayMonthly}>
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonthShort}
                  tick={MONO_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={MONO_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={formatK}
                />
                <Tooltip
                  trigger={tooltipTrigger}
                  formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                  labelFormatter={(v) => formatMonthFull(String(v))}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
                <Bar
                  dataKey="total"
                  cursor="pointer"
                  onClick={(_data: any, index: number) => {
                    const month = displayMonthly[index]?.month;
                    if (month) setSelectedMonth((prev) => (prev === month ? null : month));
                  }}
                >
                  {displayMonthly.map((m) => (
                    <Cell
                      key={m.month}
                      fill={
                        selectedMonth === m.month
                          ? "#000"
                          : selectedMonth
                          ? PALETTE.greige
                          : PALETTE.slate
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Total + This Month — 1 col, stacked */}
          <div className="row-span-2 bg-card p-4 md:p-6 flex flex-col">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              TOP CATEGORIES
            </h2>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={displayCategories.slice(0, 8)}
                  dataKey="total"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={75}
                  strokeWidth={1}
                  stroke="var(--card)"
                  style={{ cursor: "pointer" }}
                  onClick={(entry: any) => {
                    const cat = entry?.category ?? entry?.payload?.category;
                    if (cat) setSelectedCategory((prev) => (prev === cat ? null : cat));
                  }}
                >
                  {displayCategories.slice(0, 8).map((c) => (
                    <Cell
                      key={c.category}
                      fill={categoryColor(c.category)}
                      opacity={selectedCategory && selectedCategory !== c.category ? 0.25 : 1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  trigger={tooltipTrigger}
                  formatter={(value) => [formatCurrency(Number(value))]}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-0.5 flex-1 overflow-auto">
              {displayCategories.slice(0, 6).map((c) => (
                <button
                  key={c.category}
                  onClick={() => setSelectedCategory((prev) => (prev === c.category ? null : c.category))}
                  className={`flex items-center justify-between text-xs w-full px-1 -mx-1 py-0.5 hover:bg-accent/50 transition-colors ${
                    selectedCategory && selectedCategory !== c.category ? "opacity-40" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 inline-block"
                      style={{ backgroundColor: categoryColor(c.category) }}
                    />
                    <span className="font-mono">{c.category}</span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(c.total)}
                    <span className="text-muted-foreground ml-1.5">
                      {displayCategoryTotal > 0
                        ? (c.total / displayCategoryTotal * 100).toFixed(0)
                        : 0}%
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Summary stats */}
          <div className="bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              {filterLabel || "TOTAL SPEND"}
            </h2>
            <p className="font-mono text-3xl font-bold">{formatCurrency(displayTotal)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {displayMonthsActive} month{displayMonthsActive !== 1 ? "s" : ""}
              {!selectedMonth && ` · ${displayCategories.reduce((s, c) => s + c.count, 0)} transactions`}
            </p>
          </div>

          <div className="bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              MONTHLY AVG
            </h2>
            <p className="font-mono text-3xl font-bold">
              {formatCurrency(displayAvg)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">per month</p>
          </div>

          {/* Goals row */}
          {goals.length > 0 && (
            <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                GOALS
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {goals.map((g) => (
                  <div key={g.category} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span>{g.category}</span>
                      <span>
                        {formatCurrency(g.spent)} / {formatCurrency(g.monthly_limit)}
                      </span>
                    </div>
                    <div className="h-2 bg-muted">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.min(100, g.percentage)}%`,
                          backgroundColor:
                            g.percentage > 100
                              ? PALETTE.terracotta
                              : g.percentage > 80
                              ? PALETTE.mustard
                              : categoryColor(g.category),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top merchants */}
          <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              TOP MERCHANTS
            </h2>
            <div className="space-y-2">
              {merchants.slice(0, 8).map((m, i) => (
                <Link
                  key={i}
                  href={`/merchants/${merchantSlug(m.description)}`}
                  className="flex items-center justify-between text-xs -mx-1 px-1 py-0.5 hover:bg-accent transition-colors"
                >
                  <span className="truncate max-w-[300px]">{m.description}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{m.count}x</span>
                    <span className="font-mono font-medium w-20 text-right">
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* This month snapshot */}
          {(() => {
            const latest = monthly[monthly.length - 1];
            if (!latest) return null;
            const now = new Date();
            const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
            const isCurrent = latest.month === currentMonth;
            const daysElapsed = isCurrent ? now.getDate() : new Date(
              parseInt(latest.month.slice(0, 4)),
              parseInt(latest.month.slice(5, 7)),
              0
            ).getDate();
            const daysInMonth = isCurrent
              ? new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
              : daysElapsed;
            const dailyRate = latest.total / daysElapsed;
            const projected = isCurrent ? dailyRate * daysInMonth : latest.total;
            const prev = monthly.length > 1 ? monthly[monthly.length - 2] : null;
            return (
              <div className="bg-card p-4 md:p-6 flex flex-col">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  {isCurrent ? "THIS MONTH" : formatMonthFull(latest.month).toUpperCase()}
                </h2>
                <p className="font-mono text-3xl font-bold">{formatCurrency(latest.total)}</p>
                {isCurrent && (
                  <>
                    <p className="text-xs text-muted-foreground mt-1">
                      day {daysElapsed} of {daysInMonth} · {formatCurrency(dailyRate)}/day
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      projected {formatCurrency(projected)}
                    </p>
                  </>
                )}
                {prev && (
                  <p className="text-xs text-muted-foreground mt-auto pt-2">
                    {latest.total > prev.total ? "▲" : "▼"}{" "}
                    {formatCurrency(Math.abs(latest.total - prev.total))} vs {formatMonthShort(prev.month)}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
          </TabsContent>

          <TabsContent value="categories">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-border border border-border">
              {categories.map((c) => (
                <div key={c.category} className="bg-card p-4 md:p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-mono text-xs tracking-widest uppercase flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5"
                        style={{ backgroundColor: categoryColor(c.category) }}
                      />
                      {c.category}
                    </h3>
                    <span className="font-mono text-sm font-bold tabular-nums">
                      {formatCurrency(c.total)}
                      <span className="text-muted-foreground font-normal ml-1.5">
                        {totalSpend > 0 ? (c.total / totalSpend * 100).toFixed(0) : 0}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-muted">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${Math.min(100, (c.total / (categories[0]?.total || 1)) * 100)}%`,
                        backgroundColor: categoryColor(c.category),
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {c.count} transactions · {formatCurrency(c.total / (monthly.length || 1))}/mo avg
                  </p>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="income">
            <IncomeTab
              incomeByType={incomeByType}
              incomeVsSpend={incomeVsSpend}
              tooltipTrigger={tooltipTrigger}
            />
          </TabsContent>

          <TabsContent value="cashflow">
            <CashflowTab
              initialCashflow={cashflow}
              dailySpend={dailySpend}
              forecast={forecast}
              tooltipTrigger={tooltipTrigger}
            />
          </TabsContent>

          <TabsContent value="forecast">
            <ForecastTab cashForecast={cashForecast} tooltipTrigger={tooltipTrigger} />
          </TabsContent>

          <TabsContent value="networth">
            <NetWorthTab initial={netWorth} tooltipTrigger={tooltipTrigger} />
          </TabsContent>

          <TabsContent value="baseline">
            <BaselineTab tooltipTrigger={tooltipTrigger} />
          </TabsContent>
        </Tabs>
        </>
      )}
    </div>
  );
}
