"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { categoryColor, PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatMonthShort,
  formatMonthFull,
  formatK,
  formatSigned,
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
} from "recharts";

// Mirrors YoySummary in lib/db/yoy.ts (the /api/summary?type=yoy payload).
interface YoyCategoryDelta {
  category: string;
  current: number;
  previous: number;
  delta: number;
  pct: number | null;
}

interface YoyMonthPoint {
  offset: number;
  month: string;
  total: number;
  prevMonth: string;
  prevTotal: number | null;
}

interface YoySummary {
  hasFullYear: boolean;
  monthsOfData: number;
  latestMonth: string | null;
  comparisonMonth: string | null;
  latestTotal: number;
  comparisonTotal: number;
  totalDelta: number;
  totalPct: number | null;
  categories: YoyCategoryDelta[];
  months: YoyMonthPoint[];
}

// YEAR OVER YEAR — bottom of the BY CATEGORY tab. Overlay of the last 12
// months on the 12 before them (muted greige = last year, slate = this year),
// plus the top category movers for the latest data month vs the same month
// last year. Self-fetching like BaselineTab / MonthReview.
export function YoySection({
  tooltipTrigger,
}: {
  tooltipTrigger: "hover" | "click";
}) {
  const [yoy, setYoy] = useState<YoySummary | null>(null);

  useEffect(() => {
    fetch("/api/summary?type=yoy")
      .then((r) => r.json())
      .then(setYoy)
      .catch(() => setYoy(null));
  }, []);

  if (!yoy) return null;

  if (!yoy.hasFullYear) {
    return (
      <div className="mt-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-3">
          YEAR OVER YEAR
        </h2>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              A FULL YEAR OF DATA UNLOCKS THIS — {yoy.monthsOfData}/13 MONTHS SO FAR
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const movers = yoy.categories.filter((c) => Math.abs(c.delta) > 0).slice(0, 8);
  const spendingMore = yoy.totalDelta > 0;

  return (
    <div className="mt-6">
      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-3">
        YEAR OVER YEAR
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
        {/* This year vs last year overlay — 2 cols */}
        <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            THIS YEAR VS LAST YEAR
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={yoy.months}>
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
                formatter={(value, name) => [
                  formatCurrency(Number(value)),
                  name === "total" ? "This year" : "Last year",
                ]}
                labelFormatter={(v) => formatMonthFull(String(v))}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Bar dataKey="prevTotal" fill={PALETTE.greige} isAnimationActive={false} />
              <Bar dataKey="total" fill={PALETTE.slate} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.greige }} />
              LAST YEAR
            </span>
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <span className="w-2 h-2 inline-block" style={{ backgroundColor: PALETTE.slate }} />
              THIS YEAR
            </span>
          </div>
        </div>

        {/* Latest month vs same month last year */}
        <div className="bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            {yoy.latestMonth ? formatMonthFull(yoy.latestMonth).toUpperCase() : ""} VS{" "}
            {yoy.comparisonMonth ? formatMonthFull(yoy.comparisonMonth).toUpperCase() : ""}
          </h3>
          <p
            className="font-mono text-3xl font-bold"
            style={{ color: spendingMore ? PALETTE.terracotta : PALETTE.sage }}
          >
            {formatSigned(yoy.totalDelta)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {yoy.totalPct !== null
              ? `${yoy.totalPct >= 0 ? "+" : "−"}${Math.abs(yoy.totalPct).toFixed(0)}% vs last year`
              : "no spend a year ago"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatCurrency(yoy.latestTotal)} now · {formatCurrency(yoy.comparisonTotal)} then
          </p>
        </div>

        {/* Top movers — full width */}
        <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            TOP MOVERS{" "}
            {yoy.latestMonth ? `— ${formatMonthFull(yoy.latestMonth).toUpperCase()}` : ""} VS A YEAR
            AGO
          </h3>
          {movers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No category moved vs the same month last year.
            </p>
          ) : (
            <div className="space-y-2">
              {movers.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-xs gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="inline-block w-2 h-2 shrink-0"
                      style={{ backgroundColor: categoryColor(c.category) }}
                    />
                    <span className="font-mono truncate">{c.category}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {formatCurrency(c.previous)} → {formatCurrency(c.current)}
                    </span>
                    <span
                      className="font-mono font-medium tabular-nums w-20 text-right"
                      style={{ color: c.delta > 0 ? PALETTE.terracotta : PALETTE.sage }}
                    >
                      {formatSigned(c.delta)}
                    </span>
                    <span
                      className="font-mono tabular-nums w-14 text-right"
                      style={{ color: c.delta > 0 ? PALETTE.terracotta : PALETTE.sage }}
                    >
                      {c.pct === null
                        ? "NEW"
                        : `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(0)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
