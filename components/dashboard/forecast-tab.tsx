"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PALETTE } from "@/lib/colors";
import {
  formatCurrency,
  formatMonthShort,
  formatDayShort,
  formatK,
  CHART_TOOLTIP_STYLE,
  MONO_TICK,
} from "@/lib/format";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Line,
  Area,
  ComposedChart,
  ReferenceLine,
} from "recharts";

interface CFPoint {
  date: string;
  balance: number;
  low: number;
  high: number;
}

interface CFEvent {
  date: string;
  label: string;
  amount: number; // signed: + inflow, − outflow
}

interface CFHorizon {
  days: number;
  endBalance: number;
  endLow: number;
  endHigh: number;
  minBalance: number;
  minDate: string;
}

export interface CashflowForecast {
  anchor: { date: string; balance: number; period: string };
  staleDays: number;
  points: CFPoint[];
  events: CFEvent[];
  horizons: CFHorizon[];
  assumptions: {
    payrollAmount: number;
    payrollEveryDays: number;
    fixedMonthly: number;
    fixedDayOfMonth: number;
    recurringMonthly: number;
    discretionaryMonthly: number;
    sigmaMonthly: number;
    basisMonths: string[];
  };
}

const HORIZONS = [30, 60, 90];

export function ForecastTab({
  cashForecast,
  tooltipTrigger,
}: {
  cashForecast: CashflowForecast | null;
  tooltipTrigger: "hover" | "click";
}) {
  const [horizon, setHorizon] = useState(30);

  const fcHorizon = cashForecast
    ? cashForecast.horizons.find((h) => h.days === horizon) ?? null
    : null;
  const fcEndDate = cashForecast
    ? cashForecast.points[Math.min(horizon, cashForecast.points.length) - 1]?.date ?? null
    : null;
  const fcChartData = cashForecast
    ? [
        {
          date: cashForecast.anchor.date,
          balance: cashForecast.anchor.balance,
          band: [cashForecast.anchor.balance, cashForecast.anchor.balance],
        },
        ...cashForecast.points.slice(0, horizon).map((p) => ({
          date: p.date,
          balance: p.balance,
          band: [p.low, p.high],
        })),
      ]
    : [];
  const fcEvents =
    cashForecast && fcEndDate
      ? cashForecast.events.filter((e) => e.date <= fcEndDate)
      : [];
  const fcLowestLow = fcChartData.length
    ? Math.min(...fcChartData.map((p) => p.band[0]))
    : 0;
  const fcToday = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  })();
  const fcShowToday =
    !!cashForecast &&
    !!fcEndDate &&
    fcToday > cashForecast.anchor.date &&
    fcToday <= fcEndDate;

  if (!cashForecast) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            NO BALANCE ANCHOR — RE-UPLOAD YOUR LATEST CHEQUING STATEMENT
            TO CAPTURE ITS CLOSING BALANCE
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between mb-4 gap-3">
        <p className="text-xs text-muted-foreground max-w-xl min-w-[220px] flex-1">
          Estimate, not a promise — the last reconciled chequing closing
          balance projected forward with detected payroll, rent + fixed
          bills, subscription schedules, and average discretionary spend.
          Statements lag the calendar: anchored{" "}
          {formatDayShort(cashForecast.anchor.date)}
          {cashForecast.staleDays > 0
            ? ` — ${cashForecast.staleDays} days ago`
            : ""}
          .
        </p>
        <div className="flex border border-border">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`font-mono text-[10px] tracking-widest px-2.5 py-1 transition-colors ${
                horizon === h
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {h}D
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
        {/* Balance projection — 2 cols */}
        <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            PROJECTED BALANCE — NEXT {horizon} DAYS
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={fcChartData}>
              <XAxis
                dataKey="date"
                tickFormatter={formatDayShort}
                tick={MONO_TICK}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tick={MONO_TICK}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatK}
                domain={["auto", "auto"]}
              />
              <Tooltip
                trigger={tooltipTrigger}
                formatter={(value, name) => {
                  if (Array.isArray(value)) {
                    return [
                      `${formatCurrency(Number(value[0]))} – ${formatCurrency(Number(value[1]))}`,
                      "±1σ range",
                    ];
                  }
                  return [formatCurrency(Number(value)), "Projected"];
                }}
                labelFormatter={(v) => formatDayShort(String(v))}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Area
                type="monotone"
                dataKey="band"
                stroke="none"
                fill={PALETTE.dustyblue}
                fillOpacity={0.3}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="balance"
                stroke={PALETTE.slate}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {fcLowestLow < 0 && (
                <ReferenceLine
                  y={0}
                  stroke={PALETTE.terracotta}
                  strokeDasharray="4 4"
                />
              )}
              {fcShowToday && (
                <ReferenceLine
                  x={fcToday}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  strokeDasharray="2 4"
                  label={{
                    value: "TODAY",
                    fontSize: 9,
                    fontFamily: "var(--font-mono)",
                    position: "top",
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <span
                className="w-4 h-0.5 inline-block"
                style={{ backgroundColor: PALETTE.slate }}
              />
              PROJECTED
            </span>
            <span className="flex items-center gap-1.5 text-xs font-mono">
              <span
                className="w-2 h-2 inline-block"
                style={{ backgroundColor: PALETTE.dustyblue, opacity: 0.5 }}
              />
              ±1σ RANGE
            </span>
          </div>
        </div>

        {/* End / lowest / anchor summary */}
        <div className="bg-card p-4 md:p-6 flex flex-col justify-between gap-4">
          <div>
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              END OF {horizon} DAYS
            </h2>
            <p
              className="font-mono text-3xl font-bold"
              style={{
                color:
                  fcHorizon && fcHorizon.endBalance < 0
                    ? PALETTE.terracotta
                    : undefined,
              }}
            >
              {fcHorizon ? formatCurrency(fcHorizon.endBalance) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {fcHorizon
                ? `${formatCurrency(fcHorizon.endLow)} – ${formatCurrency(fcHorizon.endHigh)} (±1σ)`
                : ""}
            </p>
          </div>
          <div className="pt-4 border-t border-border">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              LOWEST POINT
            </h2>
            <p
              className="font-mono text-3xl font-bold"
              style={{
                color:
                  fcHorizon && fcHorizon.minBalance < 0
                    ? PALETTE.terracotta
                    : PALETTE.sage,
              }}
            >
              {fcHorizon ? formatCurrency(fcHorizon.minBalance) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {fcHorizon ? `around ${formatDayShort(fcHorizon.minDate)}` : ""}
            </p>
          </div>
          <div className="pt-4 border-t border-border">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
              ANCHOR
            </h2>
            <p className="font-mono text-3xl font-bold">
              {formatCurrency(cashForecast.anchor.balance)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              chequing closing · {formatDayShort(cashForecast.anchor.date)}
              {cashForecast.staleDays > 0
                ? ` · ${cashForecast.staleDays}d old`
                : ""}
            </p>
          </div>
        </div>

        {/* Estimate inputs — full width */}
        <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            ESTIMATE INPUTS
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                PAYROLL
              </p>
              <p
                className="font-mono text-lg font-bold"
                style={{ color: PALETTE.sage }}
              >
                +{formatCurrency(cashForecast.assumptions.payrollAmount)}
              </p>
              <p className="text-xs text-muted-foreground">
                every {cashForecast.assumptions.payrollEveryDays} days
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                RENT + FIXED
              </p>
              <p className="font-mono text-lg font-bold">
                −{formatCurrency(cashForecast.assumptions.fixedMonthly)}
              </p>
              <p className="text-xs text-muted-foreground">
                monthly, day {cashForecast.assumptions.fixedDayOfMonth}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                SUBSCRIPTIONS
              </p>
              <p className="font-mono text-lg font-bold">
                −{formatCurrency(cashForecast.assumptions.recurringMonthly)}
              </p>
              <p className="text-xs text-muted-foreground">
                per month, on their own cadence
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                DISCRETIONARY
              </p>
              <p className="font-mono text-lg font-bold">
                −{formatCurrency(cashForecast.assumptions.discretionaryMonthly)}
              </p>
              <p className="text-xs text-muted-foreground">
                per month, drained daily
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Band is ±1σ of monthly variable spend (
            {formatCurrency(cashForecast.assumptions.sigmaMonthly)}),
            widening with √time. Card spend is modelled the day it
            happens, not when the card payment clears; one-off income
            (refunds, winnings) is excluded. Medians from{" "}
            {cashForecast.assumptions.basisMonths
              .map(formatMonthShort)
              .join(", ")}
            .
          </p>
        </div>

        {/* Scheduled events — full width */}
        <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
            SCHEDULED IN WINDOW ({fcEvents.length})
          </h2>
          {fcEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled in this window.
            </p>
          ) : (
            <div className="space-y-2">
              {fcEvents.slice(0, 12).map((e, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-muted-foreground w-20 shrink-0">
                      {formatDayShort(e.date)}
                    </span>
                    <span className="truncate">{e.label}</span>
                  </div>
                  <span
                    className="font-mono font-medium w-24 text-right shrink-0"
                    style={{
                      color: e.amount >= 0 ? PALETTE.sage : undefined,
                    }}
                  >
                    {e.amount >= 0 ? "+" : "−"}
                    {formatCurrency(Math.abs(e.amount))}
                  </span>
                </div>
              ))}
              {fcEvents.length > 12 && (
                <p className="text-xs text-muted-foreground">
                  + {fcEvents.length - 12} more
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
