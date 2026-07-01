"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { categoryColor, PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatSigned,
  formatMonthShort,
  formatMonthFull,
  CHART_TOOLTIP_STYLE,
} from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
  Cell,
} from "recharts";

// Mirrors lib/db/monthReview.ts (MonthReview). Kept local so the component is a
// drop-in tab with no shared-type coupling beyond the JSON shape.
interface MonthTrendPoint {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number | null;
}
interface ReviewCategory {
  category: string;
  total: number;
  count: number;
}
interface BiggestMonth {
  month: string;
  total: number;
}
interface TopMerchant {
  description: string;
  total: number;
  count: number;
}
interface MonthReviewData {
  months: string[];
  month: string | null;
  income: number;
  fixed: number;
  variable: number;
  spend: number;
  net: number;
  savingsRate: number | null;
  txnCount: number;
  prevMonth: string | null;
  incomeDelta: number | null;
  spendDelta: number | null;
  netDelta: number | null;
  topCategories: ReviewCategory[];
  topMerchants: TopMerchant[];
  trend: MonthTrendPoint[];
  biggestMonths: BiggestMonth[];
  avgIncome: number;
  avgSpend: number;
  avgSavingsRate: number | null;
}

const formatPct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);

// A delta sub-line under a headline figure. `goodWhenUp` flips the colour so a
// rise in spending reads as bad (terracotta) while a rise in income reads as
// good (sage). null delta (no previous month) renders nothing.
function Delta({
  delta,
  goodWhenUp,
  format,
  prevMonth,
}: {
  delta: number | null;
  goodWhenUp: boolean;
  format: (v: number) => string;
  prevMonth: string | null;
}) {
  if (delta == null) {
    return <p className="text-[11px] text-muted-foreground mt-1">no prior month</p>;
  }
  const up = delta > 0;
  const flat = delta === 0;
  const good = flat ? null : up === goodWhenUp;
  const color = good == null ? "var(--muted-foreground)" : good ? PALETTE.sage : PALETTE.terracotta;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex items-center gap-1 text-[11px] mt-1 tabular-nums" style={{ color }}>
      <Icon className="size-3 shrink-0" />
      <span>{flat ? "no change" : format(delta)}</span>
      {prevMonth && (
        <span className="text-muted-foreground">vs {formatMonthShort(prevMonth)}</span>
      )}
    </p>
  );
}

export function MonthReview() {
  const [data, setData] = useState<MonthReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [navving, setNavving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (month: string | null) => {
    const q = month ? `&month=${encodeURIComponent(month)}` : "";
    setNavving(true);
    fetch(`/api/summary?type=month_review${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(`request failed (${r.status})`);
        return r.json();
      })
      .then((d: MonthReviewData) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "request failed"))
      .finally(() => {
        setLoading(false);
        setNavving(false);
      });
  };

  useEffect(() => load(null), []);

  if (loading) {
    return (
      <div className="h-64 border border-border bg-card animate-pulse" aria-hidden />
    );
  }

  // A failed request is NOT "no data yet" — say so instead of telling the user
  // to upload a statement they may already have uploaded.
  if (error && !data) {
    return (
      <div className="border border-border bg-card py-16 text-center">
        <p className="font-mono text-sm text-destructive">
          COULDN&apos;T LOAD MONTH REVIEW — {error.toUpperCase()}
        </p>
      </div>
    );
  }

  if (!data || !data.month || data.months.length === 0) {
    return (
      <div className="border border-border bg-card py-16 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          NO MONTHLY DATA YET — UPLOAD A CHEQUING STATEMENT TO SEE INCOME VS SPEND
        </p>
      </div>
    );
  }

  const idx = data.months.indexOf(data.month);
  const prevMonth = idx > 0 ? data.months[idx - 1] : null;
  const nextMonth = idx < data.months.length - 1 ? data.months[idx + 1] : null;

  // Savings-rate MoM delta (server gives in/out/net deltas; SR is derived here).
  const tIdx = data.trend.findIndex((t) => t.month === data.month);
  const prevPt = tIdx > 0 ? data.trend[tIdx - 1] : null;
  const srDelta =
    data.savingsRate != null && prevPt?.savingsRate != null
      ? data.savingsRate - prevPt.savingsRate
      : null;

  const inOutData = data.trend.map((t) => ({
    month: t.month,
    label: formatMonthShort(t.month),
    income: t.income,
    spend: t.spend,
  }));

  const srData = data.trend.map((t) => ({
    month: t.month,
    label: formatMonthShort(t.month),
    rate: t.savingsRate == null ? null : +(t.savingsRate * 100).toFixed(1),
  }));

  const maxCategory = data.topCategories[0]?.total ?? 0;
  const biggestMax = data.biggestMonths[0]?.total ?? 0;

  const netGood = data.net >= 0;

  return (
    <div className="space-y-[1px]">
      {/* Month selector */}
      <div className="flex items-center justify-between border border-border bg-card px-4 py-3">
        <button
          onClick={() => prevMonth && load(prevMonth)}
          disabled={!prevMonth || navving}
          aria-label="Previous month"
          className="flex items-center justify-center size-7 border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-center">
          <p className="font-mono text-sm font-bold tracking-widest uppercase">
            {formatMonthFull(data.month)}
          </p>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
            MONTH IN REVIEW · {data.txnCount} TXN{data.txnCount !== 1 ? "S" : ""}
          </p>
        </div>
        <button
          onClick={() => nextMonth && load(nextMonth)}
          disabled={!nextMonth || navving}
          aria-label="Next month"
          className="flex items-center justify-center size-7 border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Headline figures */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-border border border-border">
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            MONEY IN
          </h3>
          <p className="font-mono text-2xl md:text-3xl font-bold tabular-nums">
            {formatCurrency(data.income)}
          </p>
          <Delta delta={data.incomeDelta} goodWhenUp format={formatSigned} prevMonth={prevMonth} />
        </div>
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            MONEY OUT
          </h3>
          <p className="font-mono text-2xl md:text-3xl font-bold tabular-nums">
            {formatCurrency(data.spend)}
          </p>
          <Delta delta={data.spendDelta} goodWhenUp={false} format={formatSigned} prevMonth={prevMonth} />
        </div>
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            NET SAVED
          </h3>
          <p
            className="font-mono text-2xl md:text-3xl font-bold tabular-nums"
            style={{ color: netGood ? PALETTE.sage : PALETTE.terracotta }}
          >
            {formatSigned(data.net)}
          </p>
          <Delta delta={data.netDelta} goodWhenUp format={formatSigned} prevMonth={prevMonth} />
        </div>
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            SAVINGS RATE
          </h3>
          <p className="font-mono text-2xl md:text-3xl font-bold tabular-nums">
            {formatPct(data.savingsRate)}
          </p>
          <Delta
            delta={srDelta == null ? null : srDelta * 100}
            goodWhenUp
            format={(v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)} pts`}
            prevMonth={prevMonth}
          />
        </div>
      </div>

      {/* In vs out + savings-rate trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-border border border-border">
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-1">
            IN VS OUT
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Tap a month to review it · avg out {formatCurrency(data.avgSpend)}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={inOutData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--accent)" }}
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value, name) => [formatCurrency(Number(value)), name === "income" ? "In" : "Out"]}
                labelFormatter={(_, p) => formatMonthFull(p?.[0]?.payload?.month ?? "")}
              />
              <Bar dataKey="income" fill={PALETTE.sage} radius={0} isAnimationActive={false}>
                {inOutData.map((d) => (
                  <Cell
                    key={`in-${d.month}`}
                    cursor="pointer"
                    fillOpacity={d.month === data.month ? 1 : 0.45}
                    onClick={() => d.month !== data.month && load(d.month)}
                  />
                ))}
              </Bar>
              <Bar dataKey="spend" fill={PALETTE.terracotta} radius={0} isAnimationActive={false}>
                {inOutData.map((d) => (
                  <Cell
                    key={`out-${d.month}`}
                    cursor="pointer"
                    fillOpacity={d.month === data.month ? 1 : 0.45}
                    onClick={() => d.month !== data.month && load(d.month)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-1">
            SAVINGS RATE TREND
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            Share of income kept · avg {formatPct(data.avgSavingsRate)}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={srData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value) => [`${Number(value).toFixed(0)}%`, "Saved"]}
                labelFormatter={(_, p) => formatMonthFull(p?.[0]?.payload?.month ?? "")}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              {data.avgSavingsRate != null && (
                <ReferenceLine
                  y={+(data.avgSavingsRate * 100).toFixed(1)}
                  stroke={PALETTE.dustyblue}
                  strokeDasharray="3 3"
                />
              )}
              <ReferenceLine
                x={formatMonthShort(data.month)}
                stroke={PALETTE.slate}
                strokeDasharray="2 2"
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={PALETTE.slate}
                strokeWidth={2}
                connectNulls
                isAnimationActive={false}
                dot={{ r: 2, fill: "var(--card)", stroke: PALETTE.slate, strokeWidth: 1.5 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top categories + merchants + biggest months */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[1px] bg-border border border-border">
        <div className="bg-card p-4 md:p-6 md:col-span-2">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            TOP CATEGORIES
          </h3>
          {data.topCategories.length === 0 ? (
            <p className="text-xs text-muted-foreground">No spend this month.</p>
          ) : (
            <div className="space-y-2.5">
              {data.topCategories.slice(0, 6).map((c) => (
                <div key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 inline-block shrink-0"
                        style={{ backgroundColor: categoryColor(c.category) }}
                      />
                      <span className="font-mono truncate">{c.category}</span>
                    </span>
                    <span className="font-mono tabular-nums shrink-0 ml-2">
                      {formatCurrency(c.total)}
                      <span className="text-muted-foreground ml-1.5">
                        {data.spend > 0 ? ((c.total / data.spend) * 100).toFixed(0) : 0}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted">
                    <div
                      className="h-full"
                      style={{
                        width: `${maxCategory > 0 ? (c.total / maxCategory) * 100 : 0}%`,
                        backgroundColor: categoryColor(c.category),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            TOP MERCHANTS
          </h3>
          {data.topMerchants.length === 0 ? (
            <p className="text-xs text-muted-foreground">No card spend this month.</p>
          ) : (
            <div className="space-y-2">
              {data.topMerchants.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate">{m.description}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">{m.count}x</span>
                    <span className="font-mono tabular-nums w-16 text-right">
                      {formatCurrency(m.total)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            BIGGEST MONTHS
          </h3>
          <div className="space-y-2.5">
            {data.biggestMonths.map((b, i) => {
              const active = b.month === data.month;
              return (
                <button
                  key={b.month}
                  onClick={() => !active && load(b.month)}
                  className={`w-full space-y-1 text-left px-1 -mx-1 py-0.5 transition-colors ${
                    active ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-muted-foreground w-3">{i + 1}</span>
                      <span className={`font-mono ${active ? "font-bold" : ""}`}>
                        {formatMonthFull(b.month)}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums">{formatCurrency(b.total)}</span>
                  </div>
                  <div className="h-1.5 bg-muted ml-5">
                    <div
                      className="h-full"
                      style={{
                        width: `${biggestMax > 0 ? (b.total / biggestMax) * 100 : 0}%`,
                        backgroundColor: active ? PALETTE.terracotta : PALETTE.greige,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
