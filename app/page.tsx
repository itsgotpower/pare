"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CalendarHeatmap, type DailySpend } from "@/components/dashboard/calendar-heatmap";
import { categoryColor, PALETTE } from "@/lib/colors";
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
  LineChart,
  Line,
  Sankey,
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

interface IncomeType {
  type: string;
  total: number;
  count: number;
}

interface IncomeVsSpend {
  month: string;
  income: number;
  fixed: number;
  variable: number;
}

interface BaselineMonth {
  month: string;
  total: number;
  baseline: number;
}

interface OneOff {
  txn_date: string;
  description: string;
  amount: number;
  category: string;
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

interface Cashflow {
  months: string[];
  month: string | null;
  income: { type: string; total: number }[];
  expenses: { category: string; total: number }[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

interface CategoryPace {
  category: string;
  soFar: number;
  projected: number;
  typical: number;
}

interface Forecast {
  targetMonth: string;
  mode: "pace" | "average";
  daysOfData: number;
  daysInMonth: number;
  projectedIncome: number;
  projectedFixed: number;
  projectedVariable: number;
  projectedNet: number;
  recurringMonthly: number;
  basisMonths: string[];
  categories: CategoryPace[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const formatMonthShort = (ym: string) =>
  MONTH_NAMES[parseInt(ym.split("-")[1], 10) - 1]?.slice(0, 3) ?? ym;

const formatMonthFull = (ym: string | number) => {
  const s = String(ym);
  const [y, m] = s.split("-");
  if (!m) return s;
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
};

const THRESHOLDS = [200, 300, 500];

const SEVERITY_COLORS: Record<Insight["severity"], string> = {
  alert: PALETTE.terracotta,
  warn: PALETTE.mustard,
  good: PALETTE.sage,
  info: PALETTE.dustyblue,
};

const INCOME_TYPE_COLORS: Record<string, string> = {
  Payroll: PALETTE.sage,
  "Tax refund": PALETTE.dustyblue,
  "Health claim": PALETTE.celadon,
  Winnings: PALETTE.mustard,
  Other: PALETTE.greige,
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);

// --- CASHFLOW sankey ---
// Income types (left) → INCOME hub → spend categories + SAVED (right).
// In a deficit month the balancing node is FROM SAVINGS on the income side.
type FlowSide = "in" | "hub" | "out";

const SANKEY_TOP_CATEGORIES = 8;

function buildSankeyData(cf: Cashflow) {
  const nodes: { name: string; color: string; side: FlowSide }[] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const add = (name: string, color: string, side: FlowSide) => {
    // Keep labels inside the chart's side margins.
    nodes.push({
      name: name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name,
      color,
      side,
    });
    return nodes.length - 1;
  };

  const hub = add("INCOME", PALETTE.espresso, "hub");
  for (const i of cf.income) {
    if (i.total < 1) continue;
    links.push({
      source: add(i.type.toUpperCase(), INCOME_TYPE_COLORS[i.type] || PALETTE.greige, "in"),
      target: hub,
      value: Math.round(i.total),
    });
  }
  if (cf.net < -1) {
    links.push({
      source: add("FROM SAVINGS", PALETTE.terracotta, "in"),
      target: hub,
      value: Math.round(-cf.net),
    });
  }
  for (const e of cf.expenses.slice(0, SANKEY_TOP_CATEGORIES)) {
    if (e.total < 1) continue;
    links.push({
      source: hub,
      target: add(e.category.toUpperCase(), categoryColor(e.category), "out"),
      value: Math.round(e.total),
    });
  }
  const rest = cf.expenses
    .slice(SANKEY_TOP_CATEGORIES)
    .reduce((s, e) => s + e.total, 0);
  if (rest > 1) {
    links.push({ source: hub, target: add("EVERYTHING ELSE", PALETTE.lightgrey, "out"), value: Math.round(rest) });
  }
  if (cf.net > 1) {
    links.push({ source: hub, target: add("SAVED", PALETTE.sage, "out"), value: Math.round(cf.net) });
  }
  return { nodes, links };
}

const renderFlowNode = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload || Number.isNaN(x) || Number.isNaN(y)) return <g />;
  const side: FlowSide = payload.side;
  // Halo so labels stay readable where links cross them.
  const halo = {
    paintOrder: "stroke" as const,
    stroke: "var(--card)",
    strokeWidth: 3,
  };
  if (side === "hub") {
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={payload.color} />
        <text
          x={x + width / 2}
          y={y - 8}
          textAnchor="middle"
          fontSize={9}
          fontFamily="var(--font-mono)"
          letterSpacing="0.1em"
          fill="currentColor"
          {...halo}
        >
          {`${payload.name} ${formatCurrency(payload.value || 0)}`}
        </text>
      </g>
    );
  }
  const tx = side === "out" ? x + width + 8 : x - 8;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={payload.color} />
      <text
        x={tx}
        y={y + height / 2}
        textAnchor={side === "out" ? "start" : "end"}
        fontSize={9}
        fontFamily="var(--font-mono)"
        letterSpacing="0.05em"
        fill="currentColor"
        {...halo}
      >
        <tspan x={tx} dy={-1}>{payload.name}</tspan>
        <tspan x={tx} dy={10} fillOpacity={0.6}>
          {formatCurrency(payload.value || 0)}
        </tspan>
      </text>
    </g>
  );
};

export default function Dashboard() {
  const [monthly, setMonthly] = useState<MonthlyTotal[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [merchants, setMerchants] = useState<TopMerchant[]>([]);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [incomeByType, setIncomeByType] = useState<IncomeType[]>([]);
  const [incomeVsSpend, setIncomeVsSpend] = useState<IncomeVsSpend[]>([]);
  const [baselineMonthly, setBaselineMonthly] = useState<BaselineMonth[]>([]);
  const [oneoffs, setOneoffs] = useState<OneOff[]>([]);
  const [threshold, setThreshold] = useState(300);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [cashflow, setCashflow] = useState<Cashflow | null>(null);
  const [cashflowMonth, setCashflowMonth] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [dailySpend, setDailySpend] = useState<DailySpend[]>([]);
  const allMerchantsRef = useRef<TopMerchant[]>([]);
  const allCashflowRef = useRef<Cashflow | null>(null);

  useEffect(() => {
    fetch("/api/summary?type=all")
      .then((r) => r.json())
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
        allCashflowRef.current = data.cashflow || null;
        setForecast(data.forecast || null);
        setDailySpend(data.daily_spend || []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch(`/api/summary?type=baseline&threshold=${threshold}`)
      .then((r) => r.json())
      .then((data) => {
        setBaselineMonthly(data.monthly || []);
        setOneoffs(data.oneoffs || []);
      });
  }, [threshold]);

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

  useEffect(() => {
    if (loading) return;
    if (!cashflowMonth) {
      setCashflow(allCashflowRef.current);
      return;
    }
    fetch(`/api/summary?type=cashflow&month=${cashflowMonth}`)
      .then((r) => r.json())
      .then(setCashflow);
  }, [cashflowMonth, loading]);

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
    ? displayCategories.reduce((s, c) => s + c.total, 0)
    : selectedCategory
    ? displayMonthly.reduce((s, m) => s + m.total, 0)
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

  const totalAvg =
    baselineMonthly.length
      ? baselineMonthly.reduce((s, m) => s + m.total, 0) / baselineMonthly.length
      : 0;
  const baselineAvg =
    baselineMonthly.length
      ? baselineMonthly.reduce((s, m) => s + m.baseline, 0) / baselineMonthly.length
      : 0;
  const oneoffTotal = oneoffs.reduce((s, o) => s + o.amount, 0);

  const totalIncome = incomeByType.reduce((s, t) => s + t.total, 0);
  const netData = incomeVsSpend
    .filter((m) => m.income > 0)
    .map((m) => ({
      month: m.month,
      net: m.income - m.fixed - m.variable,
    }));
  const incomeMonths = netData.length;
  const totalNet = netData.reduce((s, m) => s + m.net, 0);
  const totalFixed = incomeVsSpend.reduce((s, m) => s + m.fixed, 0);
  const totalVariable = incomeVsSpend.reduce((s, m) => s + m.variable, 0);
  const thisMonthNet = netData.length ? netData[netData.length - 1].net : 0;
  const lastMonthNet = netData.length > 1 ? netData[netData.length - 2].net : null;
  const momDelta = lastMonthNet === null ? null : thisMonthNet - lastMonthNet;

  const totalSpend = monthly.reduce((sum, m) => sum + m.total, 0);
  const hasData = monthly.length > 0;

  const sankey =
    cashflow && cashflow.totalIncome > 0 ? buildSankeyData(cashflow) : null;
  const savingsRate =
    cashflow && cashflow.totalIncome > 0
      ? (cashflow.net / cashflow.totalIncome) * 100
      : 0;
  const forecastSpend = forecast
    ? forecast.projectedFixed + forecast.projectedVariable
    : 0;

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="p-6">
      <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-6">
        DASHBOARD
      </h1>

      {!hasData ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              NO DATA YET — GO TO UPLOAD TO IMPORT STATEMENTS
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="overview" className="font-mono text-xs tracking-widest">
              OVERVIEW
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
            <TabsTrigger value="baseline" className="font-mono text-xs tracking-widest">
              BASELINE
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
        {filterLabel && (
          <div className="flex items-center gap-3 mb-3">
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
          <div className="col-span-1 md:col-span-2 bg-card p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              MONTHLY SPEND
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={displayMonthly}>
                <XAxis
                  dataKey="month"
                  tickFormatter={formatMonthShort}
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
                  labelFormatter={(v) => formatMonthFull(String(v))}
                  contentStyle={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    border: "1px solid #000",
                    borderRadius: 0,
                  }}
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
          <div className="row-span-2 bg-card p-6 flex flex-col">
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
                  stroke="#fff"
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
                  formatter={(value) => [formatCurrency(Number(value))]}
                  contentStyle={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    border: "1px solid #000",
                    borderRadius: 0,
                  }}
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
          <div className="bg-card p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              {filterLabel || "TOTAL SPEND"}
            </h2>
            <p className="font-mono text-3xl font-bold">{formatCurrency(displayTotal)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {displayMonthsActive} month{displayMonthsActive !== 1 ? "s" : ""}
              {!selectedMonth && ` · ${displayCategories.reduce((s, c) => s + c.count, 0)} transactions`}
            </p>
          </div>

          <div className="bg-card p-6">
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
            <div className="col-span-1 md:col-span-3 bg-card p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                GOALS
              </h2>
              <div className="grid grid-cols-3 gap-4">
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
          <div className="col-span-1 md:col-span-2 bg-card p-6">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
              TOP MERCHANTS
            </h2>
            <div className="space-y-2">
              {merchants.slice(0, 8).map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[300px]">{m.description}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">{m.count}x</span>
                    <span className="font-mono font-medium w-20 text-right">
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                </div>
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
              <div className="bg-card p-6 flex flex-col">
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
                <div key={c.category} className="bg-card p-6">
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
            {incomeByType.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <p className="font-mono text-sm text-muted-foreground">
                    NO INCOME DATA — UPLOAD A CHEQUING STATEMENT
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
                {/* Income vs spend — 2 cols */}
                <div className="col-span-1 md:col-span-2 bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                    INCOME VS SPEND
                  </h2>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={incomeVsSpend}>
                      <XAxis
                        dataKey="month"
                        tickFormatter={formatMonthShort}
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(value, name) => {
                          const labels: Record<string, string> = { income: "Income", fixed: "Fixed", variable: "Variable" };
                          return [formatCurrency(Number(value)), labels[String(name)] || String(name)];
                        }}
                        labelFormatter={(v) => formatMonthFull(String(v))}
                        contentStyle={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          border: "1px solid #000",
                          borderRadius: 0,
                        }}
                      />
                      <Bar dataKey="income" fill={PALETTE.sage} />
                      <Bar dataKey="fixed" stackId="spend" fill={PALETTE.slate} />
                      <Bar dataKey="variable" stackId="spend" fill={PALETTE.terracotta} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex gap-4 mt-2">
                    <span className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.sage }} />
                      INCOME
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.slate }} />
                      FIXED
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.terracotta }} />
                      VARIABLE
                    </span>
                  </div>
                </div>

                {/* Income by type */}
                <div className="row-span-2 bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                    INCOME BY TYPE
                  </h2>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={incomeByType}
                        dataKey="total"
                        nameKey="type"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={75}
                        strokeWidth={1}
                        stroke="#fff"
                      >
                        {incomeByType.map((t) => (
                          <Cell key={t.type} fill={INCOME_TYPE_COLORS[t.type] || PALETTE.greige} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [formatCurrency(Number(value))]}
                        contentStyle={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          border: "1px solid #000",
                          borderRadius: 0,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1">
                    {incomeByType.map((t) => (
                      <div key={t.type} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2"
                            style={{ backgroundColor: INCOME_TYPE_COLORS[t.type] || PALETTE.greige }}
                          />
                          <span className="font-mono">{t.type}</span>
                        </div>
                        <span className="font-mono">{formatCurrency(t.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Net cashflow per month — 2 cols, under income vs spend */}
                <div className="col-span-1 md:col-span-2 bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                    NET CASHFLOW (INCOME − FIXED − VARIABLE)
                  </h2>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={netData}>
                      <XAxis
                        dataKey="month"
                        tickFormatter={formatMonthShort}
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(value) => [formatCurrency(Number(value)), "Net"]}
                        labelFormatter={(v) => formatMonthFull(String(v))}
                        contentStyle={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          border: "1px solid #000",
                          borderRadius: 0,
                        }}
                      />
                      <Bar dataKey="net">
                        {netData.map((m) => (
                          <Cell
                            key={m.month}
                            fill={m.net >= 0 ? PALETTE.sage : PALETTE.terracotta}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Total income */}
                <div className="bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                    TOTAL INCOME
                  </h2>
                  <p className="font-mono text-3xl font-bold">{formatCurrency(totalIncome)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {incomeMonths} months of chequing data
                  </p>
                </div>

                {/* Net this month + MoM delta */}
                <div className="bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                    NET THIS MONTH
                  </h2>
                  <p
                    className="font-mono text-3xl font-bold"
                    style={{ color: thisMonthNet >= 0 ? PALETTE.sage : PALETTE.terracotta }}
                  >
                    {thisMonthNet >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(thisMonthNet))}
                  </p>
                  {momDelta !== null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {momDelta >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(momDelta))} vs last month
                    </p>
                  )}
                </div>

                {/* Total net (period surplus) */}
                <div className="bg-card p-6">
                  <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                    PERIOD SURPLUS
                  </h2>
                  <p
                    className="font-mono text-3xl font-bold"
                    style={{ color: totalNet >= 0 ? PALETTE.sage : PALETTE.terracotta }}
                  >
                    {totalNet >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(totalNet))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    fixed {formatCurrency(totalFixed)} (incl. rent) · variable {formatCurrency(totalVariable)}
                  </p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="cashflow">
            {!cashflow || cashflow.months.length === 0 ? (
              <>
                <Card>
                  <CardContent className="py-16 text-center">
                    <p className="font-mono text-sm text-muted-foreground">
                      NO CHEQUING DATA — UPLOAD A CHEQUING STATEMENT
                    </p>
                  </CardContent>
                </Card>
                {dailySpend.length > 0 && (
                  <div className="mt-6">
                    <CalendarHeatmap days={dailySpend} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
                  <p className="text-xs text-muted-foreground max-w-xl min-w-[220px] flex-1">
                    Where the money went — income in, spending by category out,
                    the remainder saved. Only months with chequing data count.
                  </p>
                  <div className="flex flex-wrap border border-border">
                    <button
                      onClick={() => setCashflowMonth(null)}
                      className={`font-mono text-[10px] tracking-widest px-2.5 py-1 transition-colors ${
                        !cashflowMonth
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      ALL
                    </button>
                    {(allCashflowRef.current?.months || cashflow.months).map((m) => (
                      <button
                        key={m}
                        onClick={() => setCashflowMonth((prev) => (prev === m ? null : m))}
                        className={`font-mono text-[10px] tracking-widest px-2.5 py-1 transition-colors ${
                          cashflowMonth === m
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {formatMonthShort(m).toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
                  {/* Money flow sankey — 2 cols */}
                  <div className="col-span-1 md:col-span-2 bg-card p-6">
                    <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                      MONEY FLOW{" "}
                      {cashflowMonth
                        ? `— ${formatMonthFull(cashflowMonth).toUpperCase()}`
                        : `— ALL ${cashflow.months.length} MONTHS`}
                    </h2>
                    {sankey && sankey.links.length > 0 ? (
                      <ResponsiveContainer width="100%" height={360}>
                        <Sankey
                          data={sankey}
                          node={renderFlowNode}
                          nodePadding={22}
                          nodeWidth={10}
                          link={{ stroke: PALETTE.slate, strokeOpacity: 0.18 }}
                          margin={{ top: 24, right: 135, bottom: 12, left: 135 }}
                        >
                          <Tooltip
                            formatter={(value) => [formatCurrency(Number(value))]}
                            contentStyle={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              border: "1px solid #000",
                              borderRadius: 0,
                            }}
                          />
                        </Sankey>
                      </ResponsiveContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground py-12 text-center">
                        No income recorded for this period.
                      </p>
                    )}
                  </div>

                  {/* In / out / net summary */}
                  <div className="bg-card p-6 flex flex-col justify-between gap-4">
                    <div>
                      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                        MONEY IN
                      </h2>
                      <p className="font-mono text-3xl font-bold">
                        {formatCurrency(cashflow.totalIncome)}
                      </p>
                    </div>
                    <div className="pt-4 border-t border-border">
                      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                        MONEY OUT
                      </h2>
                      <p className="font-mono text-3xl font-bold">
                        {formatCurrency(cashflow.totalExpenses)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        incl. rent and bank fees
                      </p>
                    </div>
                    <div className="pt-4 border-t border-border">
                      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                        {cashflow.net >= 0 ? "SAVED" : "DRAWN FROM SAVINGS"}
                      </h2>
                      <p
                        className="font-mono text-3xl font-bold"
                        style={{
                          color: cashflow.net >= 0 ? PALETTE.sage : PALETTE.terracotta,
                        }}
                      >
                        {cashflow.net >= 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(cashflow.net))}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {savingsRate.toFixed(0)}% of income
                      </p>
                    </div>
                  </div>
                </div>

                {dailySpend.length > 0 && (
                  <div className="mt-6">
                    <CalendarHeatmap days={dailySpend} syncMonth={cashflowMonth} />
                  </div>
                )}

                {forecast && (
                  <>
                    <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mt-6 mb-3">
                      FORECAST — {formatMonthFull(forecast.targetMonth).toUpperCase()}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
                      <div className="bg-card p-6">
                        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                          PROJECTED SPEND
                        </h2>
                        <p className="font-mono text-3xl font-bold">
                          {formatCurrency(forecastSpend)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          fixed {formatCurrency(forecast.projectedFixed)} · variable{" "}
                          {formatCurrency(forecast.projectedVariable)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {forecast.mode === "pace"
                            ? `paced from day ${forecast.daysOfData} of ${forecast.daysInMonth}`
                            : `median of last ${forecast.basisMonths.length} complete months`}
                        </p>
                      </div>
                      <div className="bg-card p-6">
                        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                          PROJECTED NET
                        </h2>
                        <p
                          className="font-mono text-3xl font-bold"
                          style={{
                            color:
                              forecast.projectedNet >= 0
                                ? PALETTE.sage
                                : PALETTE.terracotta,
                          }}
                        >
                          {forecast.projectedNet >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(forecast.projectedNet))}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          payroll {formatCurrency(forecast.projectedIncome)} expected
                          · one-off income excluded
                        </p>
                      </div>
                      <div className="bg-card p-6">
                        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                          RECURRING COMMITTED
                        </h2>
                        <p className="font-mono text-3xl font-bold">
                          {formatCurrency(forecast.recurringMonthly)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          subscriptions / month, already inside projected spend
                        </p>
                      </div>

                      {forecast.mode === "pace" && forecast.categories.length > 0 && (
                        <div className="col-span-1 md:col-span-3 bg-card p-6">
                          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                            CATEGORY PACE (DAY {forecast.daysOfData} OF {forecast.daysInMonth})
                          </h2>
                          <div className="space-y-2">
                            {forecast.categories.slice(0, 6).map((c) => {
                              const over = c.projected - c.typical;
                              return (
                                <div
                                  key={c.category}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-2 h-2 inline-block shrink-0"
                                      style={{ backgroundColor: categoryColor(c.category) }}
                                    />
                                    <span className="font-mono truncate">{c.category}</span>
                                  </span>
                                  <span className="font-mono tabular-nums flex items-center gap-3 shrink-0">
                                    <span className="text-muted-foreground hidden sm:inline">
                                      {formatCurrency(c.soFar)} so far
                                    </span>
                                    <span className="w-24 text-right">
                                      → {formatCurrency(c.projected)}
                                    </span>
                                    <span
                                      className="w-28 text-right"
                                      style={{
                                        color:
                                          c.typical > 0 && over > 0
                                            ? PALETTE.terracotta
                                            : PALETTE.sage,
                                      }}
                                    >
                                      {c.typical > 0
                                        ? `${over >= 0 ? "+" : "−"}${formatCurrency(Math.abs(over))} vs usual`
                                        : "new"}
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="baseline">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground max-w-xl">
                Discretionary baseline = spending with large one-off charges removed —
                the typical monthly number for runway planning. One-offs are single
                charges at or above the threshold.
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  One-off ≥
                </span>
                <div className="flex border border-border">
                  {THRESHOLDS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setThreshold(t)}
                      className={`font-mono text-[10px] tracking-widest px-2.5 py-1 transition-colors ${
                        threshold === t
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      ${t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
              {/* Total vs baseline chart — 2 cols */}
              <div className="col-span-1 md:col-span-2 bg-card p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                  TOTAL VS BASELINE SPEND
                </h2>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={baselineMonthly}>
                    <XAxis
                      dataKey="month"
                      tickFormatter={formatMonthShort}
                      tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatCurrency(Number(value)),
                        name === "total" ? "Total" : "Baseline",
                      ]}
                      labelFormatter={(v) => formatMonthFull(String(v))}
                      contentStyle={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        border: "1px solid #000",
                        borderRadius: 0,
                      }}
                    />
                    <Bar dataKey="total" fill={PALETTE.greige} />
                    <Bar dataKey="baseline" fill={PALETTE.slate} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  <span className="flex items-center gap-1.5 text-xs font-mono">
                    <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.greige }} />
                    TOTAL
                  </span>
                  <span className="flex items-center gap-1.5 text-xs font-mono">
                    <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.slate }} />
                    BASELINE
                  </span>
                </div>
              </div>

              {/* Averages */}
              <div className="bg-card p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                  BASELINE AVG
                </h2>
                <p className="font-mono text-3xl font-bold">{formatCurrency(baselineAvg)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  per month · vs {formatCurrency(totalAvg)} total
                </p>
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-1">
                    EXCLUDED ONE-OFFS
                  </p>
                  <p className="font-mono text-lg font-bold">
                    {oneoffs.length} · {formatCurrency(oneoffTotal)}
                  </p>
                </div>
              </div>

              {/* Excluded one-offs list — full width */}
              <div className="col-span-1 md:col-span-3 bg-card p-6">
                <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                  EXCLUDED ONE-OFF CHARGES (≥ ${threshold})
                </h2>
                {oneoffs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None at this threshold.</p>
                ) : (
                  <div className="space-y-2">
                    {oneoffs.map((o, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-muted-foreground w-20 shrink-0">
                            {o.txn_date}
                          </span>
                          <span
                            className="inline-block w-2 h-2 shrink-0"
                            style={{ backgroundColor: categoryColor(o.category) }}
                          />
                          <span className="truncate">{o.description}</span>
                        </div>
                        <span className="font-mono font-medium w-20 text-right shrink-0">
                          {formatCurrency(o.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        </>
      )}
    </div>
  );
}
