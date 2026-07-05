"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Moon,
  Sun,
  Workflow,
  TrendingUp,
  Landmark,
  Repeat,
  CalendarDays,
  Brain,
} from "lucide-react";
import dynamic from "next/dynamic";
import { categoryColor, PALETTE } from "@/lib/colors";
import { formatCurrency, formatMonthShort } from "@/lib/format";
import { Wordmark } from "@/components/layout/wordmark";
import { GithubMark } from "@/components/layout/github-mark";
import { FooterNav, REPO_URL } from "@/components/layout/footer-nav";

// Charts load client-only (ssr:false): keeps recharts' SSR path for this route
// out of the worker bundle — the Free-plan 3 MiB gzip limit is ~17 KiB away on
// main, and /demo's SSR chunk pushed it over (failed Workers Builds, PR #71).
const chartFallback = (h: number) => {
  const Skeleton = () => (
    <div style={{ height: h }} className="bg-accent/40 animate-pulse" aria-hidden />
  );
  return Skeleton;
};
const DemoMonthlyBar = dynamic(
  () => import("@/components/demo/demo-charts").then((m) => m.DemoMonthlyBar),
  { ssr: false, loading: chartFallback(220) }
);
const DemoCategoryDonut = dynamic(
  () => import("@/components/demo/demo-charts").then((m) => m.DemoCategoryDonut),
  { ssr: false, loading: chartFallback(180) }
);
const DemoIncomeSpendBar = dynamic(
  () => import("@/components/demo/demo-charts").then((m) => m.DemoIncomeSpendBar),
  { ssr: false, loading: chartFallback(200) }
);

// Public, signed-out product demo: the OVERVIEW bento rendered from a
// checked-in SYNTHETIC payload (public/demo-data.json, regenerated with
// `npm run gen:demo`). No DB, no auth, works on both deploy targets — the
// middleware lists /demo as public and the JSON is a static asset. Only
// month-anchored figures are shown; today-relative surfaces (forecast,
// insights, safe-to-spend) would rot in a frozen snapshot.

// Feature teasers for the "MORE IN THE FULL APP" strip. These surfaces update
// against today's date (forecast, net worth, recurring cadence…), so they'd rot
// in a frozen snapshot — described here rather than rendered from static data.
const MORE_FEATURES: { icon: typeof Workflow; title: string; desc: string }[] = [
  {
    icon: Workflow,
    title: "Cash-flow Sankey",
    desc: "Watch each paycheque flow — income in, categories out, savings kept — for any month.",
  },
  {
    icon: TrendingUp,
    title: "30/60/90-day forecast",
    desc: "Project your balance forward from your latest statement, with an uncertainty band.",
  },
  {
    icon: Landmark,
    title: "Net worth",
    desc: "Track assets and liabilities over time from statement balances and manual entries.",
  },
  {
    icon: Repeat,
    title: "Recurring & subscriptions",
    desc: "Auto-detect subscriptions, flag price hikes and double-bills, and mark ones to cancel.",
  },
  {
    icon: CalendarDays,
    title: "Daily spend heatmap",
    desc: "A calendar of every day's spending, plus your typical spend by weekday.",
  },
  {
    icon: Brain,
    title: "Ask Claude",
    desc: "Query your finances in plain language through the built-in MCP server.",
  },
];

interface MonthlyTotal { month: string; total: number }
interface CategoryBreakdown { category: string; total: number; count: number }
interface TopMerchant { description: string; total: number; count: number }
interface GoalProgress {
  category: string;
  monthly_limit: number;
  spent: number;
  percentage: number;
}
interface IncomeVsSpend { month: string; income: number; fixed: number; variable: number }

interface DemoData {
  monthly_totals: MonthlyTotal[];
  category_breakdown: CategoryBreakdown[];
  top_merchants: TopMerchant[];
  goals: GoalProgress[];
  income_vs_spend: IncomeVsSpend[];
}

const goalColor = (pct: number) =>
  pct >= 100 ? PALETTE.terracotta : pct >= 80 ? PALETTE.mustard : PALETTE.sage;

export default function DemoPage() {
  const [data, setData] = useState<DemoData | null>(null);
  const [error, setError] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    fetch("/demo-data.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (localStorage.getItem("parse-dark") === "true") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("parse-dark", String(next));
  };

  const monthly = data ? [...data.monthly_totals].reverse() : [];
  const categories = data?.category_breakdown ?? [];
  const categoryTotal = categories.reduce((s, c) => s + c.total, 0);
  const totalSpend = monthly.reduce((s, m) => s + m.total, 0);
  const activeMonths = monthly.filter((m) => m.total > 0).length;
  const ivs = data?.income_vs_spend ?? [];
  const totalIncome = ivs.reduce((s, m) => s + m.income, 0);
  const totalOut = ivs.reduce((s, m) => s + m.fixed + m.variable, 0);
  const savingsRate = totalIncome > 0 ? (totalIncome - totalOut) / totalIncome : null;
  const netData = ivs.map((m) => ({
    month: m.month,
    label: formatMonthShort(m.month),
    income: m.income,
    spend: m.fixed + m.variable,
  }));

  return (
    <div className="min-h-full flex flex-col">
      {/* Top bar — consistent marketing chrome (matches the landing header). */}
      <header className="shrink-0 flex items-center justify-between border-b border-border px-4 md:px-6 h-14">
        <div className="flex items-center gap-3">
          <Wordmark href="/" className="font-mono text-sm font-bold tracking-tight" />
          <span
            className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 border"
            style={{ borderColor: PALETTE.mustard, color: PALETTE.mustard }}
          >
            SAMPLE DATA
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <GithubMark className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <Link
            href="/login"
            className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            className="font-mono text-[10px] md:text-xs tracking-widest uppercase border border-input px-3 py-1.5 hover:bg-accent transition-colors"
          >
            Sign up
          </Link>
          <button
            onClick={toggleDark}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
          THE DEMO
        </h1>
        <p className="text-xs text-muted-foreground mb-6 max-w-2xl">
          Every number below is synthetic — a fake year of statements across a few
          accounts, run through the real dashboard. This is what Pare looks like
          once you&apos;ve dropped in the statements you already have. No account,
          no bank login, nothing tracked.
        </p>

        {error && (
          <div className="border border-border py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              COULDN&apos;T LOAD SAMPLE DATA
            </p>
          </div>
        )}
        {!data && !error && (
          <div className="h-64 border border-border bg-card animate-pulse" aria-hidden />
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
            {/* Monthly spend — 2 cols */}
            <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                MONTHLY SPEND
              </h2>
              <DemoMonthlyBar monthly={monthly} />
            </div>

            {/* Categories — 1 col, spans two rows */}
            <div className="row-span-2 bg-card p-4 md:p-6 flex flex-col">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                TOP CATEGORIES
              </h2>
              <DemoCategoryDonut categories={categories} />
              <div className="mt-2 space-y-0.5 flex-1">
                {categories.slice(0, 6).map((c) => (
                  <div key={c.category} className="flex items-center justify-between text-xs px-1 -mx-1 py-0.5">
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
                        {categoryTotal > 0 ? ((c.total / categoryTotal) * 100).toFixed(0) : 0}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stat cards */}
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                TOTAL SPEND
              </h2>
              <p className="font-mono text-3xl font-bold">{formatCurrency(totalSpend)}</p>
              <p className="text-xs text-muted-foreground mt-1">{activeMonths} months</p>
            </div>
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
                SAVINGS RATE
              </h2>
              <p
                className="font-mono text-3xl font-bold"
                style={{
                  color:
                    savingsRate == null
                      ? undefined
                      : savingsRate >= 0
                      ? PALETTE.sage
                      : PALETTE.terracotta,
                }}
              >
                {savingsRate == null ? "—" : `${(savingsRate * 100).toFixed(0)}%`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">of income kept, all-time</p>
            </div>

            {/* Income vs spend — 2 cols */}
            <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                INCOME VS SPEND
              </h2>
              <DemoIncomeSpendBar netData={netData} />
            </div>

            {/* Goals */}
            <div className="bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                GOALS
              </h2>
              <div className="space-y-3">
                {data.goals.slice(0, 6).map((g) => (
                  <div key={g.category}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono truncate">{g.category}</span>
                      <span className="font-mono tabular-nums shrink-0">
                        {formatCurrency(g.spent)}
                        <span className="text-muted-foreground"> / {formatCurrency(g.monthly_limit)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-accent">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.min(100, g.percentage)}%`,
                          backgroundColor: goalColor(g.percentage),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top merchants — full width */}
            <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
              <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
                TOP MERCHANTS
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                {data.top_merchants.map((m) => (
                  <div key={m.description} className="flex items-center justify-between text-xs">
                    <span className="font-mono truncate">{m.description}</span>
                    <span className="font-mono tabular-nums shrink-0 ml-3">
                      <span className="text-muted-foreground mr-2">{m.count}×</span>
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MORE IN THE FULL APP — feature teasers for surfaces the static demo
            can't render (they're today-relative / live). */}
        <section className="mt-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-1">
            MORE IN THE FULL APP
          </h2>
          <p className="text-xs text-muted-foreground mb-4 max-w-2xl">
            These surfaces update against today&apos;s date, so they&apos;re live in
            the app rather than this frozen snapshot — sign up to see yours.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[1px] bg-border border border-border">
            {MORE_FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="bg-card p-4 md:p-5">
                  <Icon className="size-5 mb-2 text-muted-foreground" />
                  <h3 className="font-mono text-sm font-bold mb-1">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CTA band */}
        <div className="mt-6 border border-border p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="font-mono text-sm font-bold tracking-widest uppercase">
              BUILT FROM A YEAR OF STATEMENTS
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">
              A synthetic year across a few accounts — the picture you get once
              you&apos;ve dropped in the statements you already have. No bank login,
              files shredded after parsing, and the self-host version never phones
              home at all.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/login?signup=1"
              className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase bg-foreground text-background px-4 py-2 hover:opacity-90 transition-opacity"
            >
              Sign up <ArrowRight className="size-3.5" />
            </Link>
            <Link
              href="/login"
              className="font-mono text-xs tracking-widest uppercase border border-input px-4 py-2 hover:bg-accent transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>

      {/* Footer — consistent marketing links. */}
      <footer className="shrink-0 border-t border-border px-4 md:px-6 py-4 flex flex-col gap-3">
        <FooterNav />
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span aria-hidden="true">✂️🍐</span>
          <span className="font-mono tracking-wide uppercase text-foreground">Pare</span>
          <span className="hidden sm:inline">— private by design.</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">© {new Date().getFullYear()} pare.money</span>
        </span>
      </footer>
    </div>
  );
}
