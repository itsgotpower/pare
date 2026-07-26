"use client";

import { Card, CardContent } from "@/components/ui/card";
import { INCOME_TYPE_COLORS } from "@/components/dashboard/cashflow-sankey";
import { PALETTE } from "@/lib/colors";
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
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";

export interface IncomeType {
  type: string;
  total: number;
  count: number;
}

export interface IncomeVsSpend {
  month: string;
  income: number;
  fixed: number;
  variable: number;
}

export function IncomeTab({
  incomeByType,
  incomeVsSpend,
  tooltipTrigger,
}: {
  incomeByType: IncomeType[];
  incomeVsSpend: IncomeVsSpend[];
  tooltipTrigger: "hover" | "click";
}) {
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

  // Savings rate = net ÷ income, only for months with chequing data (income > 0
  // — same qualifying set as netData, so the two charts always agree).
  const savingsData = incomeVsSpend
    .filter((m) => m.income > 0)
    .map((m) => ({
      month: m.month,
      rate: ((m.income - m.fixed - m.variable) / m.income) * 100,
    }));
  const currentRate = savingsData.length ? savingsData[savingsData.length - 1].rate : null;
  const trailing3 = savingsData.slice(-3);
  const trailing3Avg = trailing3.length
    ? trailing3.reduce((s, m) => s + m.rate, 0) / trailing3.length
    : null;

  if (incomeByType.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            NO INCOME DATA — UPLOAD A CHEQUING STATEMENT
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
      {/* Income vs spend — 2 cols */}
      <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          INCOME VS SPEND
        </h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={incomeVsSpend}>
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
              formatter={(value, name) => {
                const labels: Record<string, string> = { income: "Income", fixed: "Fixed", variable: "Variable" };
                return [formatCurrency(Number(value)), labels[String(name)] || String(name)];
              }}
              labelFormatter={(v) => formatMonthFull(String(v))}
              contentStyle={CHART_TOOLTIP_STYLE}
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
      <div className="row-span-2 bg-card p-4 md:p-6">
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
              stroke="var(--card)"
            >
              {incomeByType.map((t) => (
                <Cell key={t.type} fill={INCOME_TYPE_COLORS[t.type] || PALETTE.greige} />
              ))}
            </Pie>
            <Tooltip
              trigger={tooltipTrigger}
              formatter={(value) => [formatCurrency(Number(value))]}
              contentStyle={CHART_TOOLTIP_STYLE}
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
      <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          NET CASHFLOW (INCOME − FIXED − VARIABLE)
        </h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={netData}>
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
              formatter={(value) => [formatCurrency(Number(value)), "Net"]}
              labelFormatter={(v) => formatMonthFull(String(v))}
              contentStyle={CHART_TOOLTIP_STYLE}
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
      <div className="bg-card p-4 md:p-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
          TOTAL INCOME
        </h2>
        <p className="font-mono text-3xl font-bold">{formatCurrency(totalIncome)}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {incomeMonths} months of chequing data
        </p>
      </div>

      {/* Net this month + MoM delta */}
      <div className="bg-card p-4 md:p-6">
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
      <div className="bg-card p-4 md:p-6">
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

      {/* Savings rate trend — 2 cols */}
      <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          SAVINGS RATE (NET ÷ INCOME)
        </h2>
        {savingsData.length <= 1 ? (
          <p className="font-mono text-sm text-muted-foreground py-12 text-center">
            NEEDS 2+ MONTHS OF CHEQUING DATA FOR A TREND
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={savingsData}>
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
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                trigger={tooltipTrigger}
                formatter={(value) => [`${Number(value).toFixed(1)}%`, "Savings rate"]}
                labelFormatter={(v) => formatMonthFull(String(v))}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <ReferenceLine y={0} stroke="var(--border)" ifOverflow="extendDomain" />
              <Line
                type="monotone"
                dataKey="rate"
                stroke={PALETTE.slate}
                strokeWidth={2}
                isAnimationActive={false}
                dot={{ r: 2, fill: "var(--card)", stroke: PALETTE.slate, strokeWidth: 1.5 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Savings rate stat: current vs trailing-3-month average */}
      <div className="bg-card p-4 md:p-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
          SAVINGS RATE
        </h2>
        {currentRate === null ? (
          <p className="font-mono text-3xl font-bold text-muted-foreground">—</p>
        ) : (
          <>
            <p
              className="font-mono text-3xl font-bold"
              style={{ color: currentRate >= 0 ? PALETTE.sage : PALETTE.terracotta }}
            >
              {currentRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatMonthFull(savingsData[savingsData.length - 1].month)}
            </p>
            {trailing3Avg !== null && savingsData.length > 1 && (
              <p className="text-xs text-muted-foreground mt-1">
                {currentRate >= trailing3Avg ? "▲" : "▼"} 3-mo avg {trailing3Avg.toFixed(1)}%
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
