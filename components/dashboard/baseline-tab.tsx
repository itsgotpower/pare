"use client";

import { useState, useEffect } from "react";
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
} from "recharts";

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

const THRESHOLDS = [200, 300, 500];

export function BaselineTab({
  tooltipTrigger,
}: {
  tooltipTrigger: "hover" | "click";
}) {
  const [baselineMonthly, setBaselineMonthly] = useState<BaselineMonth[]>([]);
  const [oneoffs, setOneoffs] = useState<OneOff[]>([]);
  const [threshold, setThreshold] = useState(300);

  useEffect(() => {
    fetch(`/api/summary?type=baseline&threshold=${threshold}`)
      .then((r) => r.json())
      .then((data) => {
        setBaselineMonthly(data.monthly || []);
        setOneoffs(data.oneoffs || []);
      });
  }, [threshold]);

  const totalAvg =
    baselineMonthly.length
      ? baselineMonthly.reduce((s, m) => s + m.total, 0) / baselineMonthly.length
      : 0;
  const baselineAvg =
    baselineMonthly.length
      ? baselineMonthly.reduce((s, m) => s + m.baseline, 0) / baselineMonthly.length
      : 0;
  const oneoffTotal = oneoffs.reduce((s, o) => s + o.amount, 0);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
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
        <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            TOTAL VS BASELINE SPEND
          </h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={baselineMonthly}>
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
                  name === "total" ? "Total" : "Baseline",
                ]}
                labelFormatter={(v) => formatMonthFull(String(v))}
                contentStyle={CHART_TOOLTIP_STYLE}
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
        <div className="bg-card p-4 md:p-6">
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
        <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
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
    </>
  );
}
