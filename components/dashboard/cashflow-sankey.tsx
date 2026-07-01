"use client";

import { categoryColor, PALETTE } from "@/lib/colors";
import { formatCurrency } from "@/lib/format";

export interface Cashflow {
  months: string[];
  month: string | null;
  income: { type: string; total: number }[];
  expenses: { category: string; total: number }[];
  totalIncome: number;
  totalExpenses: number;
  net: number;
}

export const INCOME_TYPE_COLORS: Record<string, string> = {
  Payroll: PALETTE.sage,
  "Tax refund": PALETTE.dustyblue,
  "Health claim": PALETTE.celadon,
  Winnings: PALETTE.mustard,
  Other: PALETTE.greige,
};

// --- CASHFLOW sankey ---
// Income types (left) → INCOME hub → spend categories + SAVED (right).
// In a deficit month the balancing node is FROM SAVINGS on the income side.
export type FlowSide = "in" | "hub" | "out";

const SANKEY_TOP_CATEGORIES = 8;

export function buildSankeyData(cf: Cashflow) {
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

export const renderFlowNode = (props: any) => {
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
