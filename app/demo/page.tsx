"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import dynamic from "next/dynamic";
import { categoryColor, PALETTE } from "@/lib/colors";
import { formatCurrency, formatMonthShort } from "@/lib/format";

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

const WAITLIST_ONLY = process.env.NEXT_PUBLIC_WAITLIST_ONLY === "1";

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
  // Mobile nav drawer (below `sm`); the inline links render on desktop.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/demo-data.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // While the drawer is open: lock body scroll, close on Escape, and close if the
  // viewport grows past `sm` (matches the marketing header behaviour).
  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const mql = window.matchMedia("(min-width: 640px)");
    const onDesktop = () => mql.matches && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    mql.addEventListener("change", onDesktop);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      mql.removeEventListener("change", onDesktop);
    };
  }, [menuOpen]);

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
      {/* Top bar — marketing chrome, not the app sidebar */}
      <header className="flex items-center justify-between border-b border-border px-4 md:px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-mono text-sm font-bold tracking-widest">
            PARE
          </Link>
          <span
            className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 border"
            style={{ borderColor: PALETTE.mustard, color: PALETTE.mustard }}
          >
            SAMPLE DATA
          </span>
        </div>
        {/* Desktop nav — inline from `sm` up. Below `sm` it collapses into the
            hamburger so the SAMPLE DATA pill + CTA stop crowding on phones. */}
        <div className="hidden sm:flex items-center gap-4">
          {!WAITLIST_ONLY && (
            <Link
              href="/login"
              className="font-mono text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/"
            className="font-mono text-xs tracking-widest uppercase border border-input px-3 py-1.5 hover:bg-accent"
          >
            Join waitlist
          </Link>
        </div>

        {/* Mobile — hamburger; the links live in the drawer below. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="demo-mobile-menu"
          className="flex sm:hidden items-center justify-center -mr-1 p-1 text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </header>

      {/* Mobile nav drawer — full-width sheet under a scrim, `sm:hidden` so it can
          never appear on desktop. Rows are ≥44px tall for comfortable tapping. */}
      {menuOpen && (
        <div className="sm:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <div
            id="demo-mobile-menu"
            className="absolute inset-x-0 top-0 bg-card border-b border-border shadow-sm"
          >
            {/* Mirror the bar: PARE + SAMPLE DATA pill, icon flips to a close (X). */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold tracking-widest">PARE</span>
                <span
                  className="font-mono text-[10px] tracking-widest px-1.5 py-0.5 border"
                  style={{ borderColor: PALETTE.mustard, color: PALETTE.mustard }}
                >
                  SAMPLE DATA
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="flex items-center justify-center -mr-1 p-1 text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex flex-col font-mono text-xs tracking-widest uppercase">
              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="flex items-center px-4 min-h-[3.25rem] border-b border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                Home
              </Link>
              {!WAITLIST_ONLY && (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center px-4 min-h-[3.25rem] border-b border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between gap-3 px-4 min-h-[3.25rem] text-foreground hover:bg-secondary/50 transition-colors"
              >
                Join waitlist <ArrowRight className="size-4" />
              </Link>
            </nav>
          </div>
        </div>
      )}

      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase mb-1">
          THE DEMO
        </h1>
        <p className="text-xs text-muted-foreground mb-6 max-w-2xl">
          Every number below is synthetic — a fake year of statements through the
          real dashboard. This is what Pare looks like about 30 seconds after you
          drop your first PDF. No account, no bank login, nothing tracked.
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

        {/* CTA band */}
        <div className="mt-6 border border-border p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="font-mono text-sm font-bold tracking-widest uppercase">
              THIS TOOK ONE PDF DROP
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-lg">
              Upload a statement you already have — no bank login, files shredded
              after parsing, and the self-host version never phones home at all.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase bg-foreground text-background px-4 py-2 hover:opacity-90"
            >
              Join the waitlist <ArrowRight className="size-3.5" />
            </Link>
            {!WAITLIST_ONLY && (
              <Link
                href="/login"
                className="font-mono text-xs tracking-widest uppercase border border-input px-4 py-2 hover:bg-accent"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
