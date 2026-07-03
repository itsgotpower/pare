"use client";

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

// The /demo page's recharts pieces, split out so the page can load them with
// next/dynamic { ssr: false }. This keeps recharts' SSR path for this route
// OUT of the worker bundle — the waitlist deploy runs on the Workers FREE
// plan, whose 3 MiB gzip limit the bundle already brushes against (see PR #71:
// crossing it fails the required "Workers Builds" check with no visible error).

interface MonthlyTotal { month: string; total: number }
interface CategoryBreakdown { category: string; total: number; count: number }

export function DemoMonthlyBar({ monthly }: { monthly: MonthlyTotal[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={monthly}>
        <XAxis
          dataKey="month"
          tickFormatter={formatMonthShort}
          tick={MONO_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={MONO_TICK} axisLine={false} tickLine={false} tickFormatter={formatK} />
        <Tooltip
          formatter={(value) => [formatCurrency(Number(value)), "Spend"]}
          labelFormatter={(v) => formatMonthFull(String(v))}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Bar dataKey="total" fill={PALETTE.slate} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DemoCategoryDonut({ categories }: { categories: CategoryBreakdown[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie
          data={categories.slice(0, 8)}
          dataKey="total"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={75}
          strokeWidth={1}
          stroke="var(--card)"
          isAnimationActive={false}
        >
          {categories.slice(0, 8).map((c) => (
            <Cell key={c.category} fill={categoryColor(c.category)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [formatCurrency(Number(value))]}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DemoIncomeSpendBar({
  netData,
}: {
  netData: { label: string; income: number; spend: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={netData}>
        <XAxis dataKey="label" tick={MONO_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={MONO_TICK} axisLine={false} tickLine={false} tickFormatter={formatK} />
        <Tooltip
          formatter={(value, name) => [formatCurrency(Number(value)), name === "income" ? "Income" : "Spend"]}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Bar dataKey="income" fill={PALETTE.sage} isAnimationActive={false} />
        <Bar dataKey="spend" fill={PALETTE.terracotta} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
