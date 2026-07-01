"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarHeatmap, type DailySpend } from "@/components/dashboard/calendar-heatmap";
import {
  buildSankeyData,
  renderFlowNode,
  type Cashflow,
} from "@/components/dashboard/cashflow-sankey";
import { categoryColor, PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatMonthShort,
  formatMonthFull,
  CHART_TOOLTIP_STYLE,
} from "@/lib/format";
import { Tooltip, ResponsiveContainer, Sankey } from "recharts";

interface CategoryPace {
  category: string;
  soFar: number;
  projected: number;
  typical: number;
}

export interface Forecast {
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

export function CashflowTab({
  initialCashflow,
  dailySpend,
  forecast,
  tooltipTrigger,
}: {
  initialCashflow: Cashflow | null;
  dailySpend: DailySpend[];
  forecast: Forecast | null;
  tooltipTrigger: "hover" | "click";
}) {
  const [cashflow, setCashflow] = useState<Cashflow | null>(initialCashflow);
  const [cashflowMonth, setCashflowMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!cashflowMonth) {
      setCashflow(initialCashflow);
      return;
    }
    fetch(`/api/summary?type=cashflow&month=${cashflowMonth}`)
      .then((r) => r.json())
      .then(setCashflow);
  }, [cashflowMonth, initialCashflow]);

  const sankey =
    cashflow && cashflow.totalIncome > 0 ? buildSankeyData(cashflow) : null;
  const savingsRate =
    cashflow && cashflow.totalIncome > 0
      ? (cashflow.net / cashflow.totalIncome) * 100
      : 0;
  const forecastSpend = forecast
    ? forecast.projectedFixed + forecast.projectedVariable
    : 0;

  if (!cashflow || cashflow.months.length === 0) {
    return (
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
    );
  }

  return (
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
          {(initialCashflow?.months || cashflow.months).map((m) => (
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
        <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            MONEY FLOW{" "}
            {cashflowMonth
              ? `— ${formatMonthFull(cashflowMonth).toUpperCase()}`
              : `— ALL ${cashflow.months.length} MONTHS`}
          </h2>
          {sankey && sankey.links.length > 0 ? (
            // The sankey needs ~135px per side for its labels —
            // scrolls sideways on phones instead of squeezing.
            <div className="overflow-x-auto">
            <div className="min-w-[560px]">
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
                  trigger={tooltipTrigger}
                  formatter={(value) => [formatCurrency(Number(value))]}
                  contentStyle={CHART_TOOLTIP_STYLE}
                />
              </Sankey>
            </ResponsiveContainer>
            </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No income recorded for this period.
            </p>
          )}
        </div>

        {/* In / out / net summary */}
        <div className="bg-card p-4 md:p-6 flex flex-col justify-between gap-4">
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
            <div className="bg-card p-4 md:p-6">
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
            <div className="bg-card p-4 md:p-6">
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
            <div className="bg-card p-4 md:p-6">
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
              <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
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
  );
}
