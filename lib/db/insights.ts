import { getDb } from "../db";
import { getForecast } from "./forecast";
import { listGoals } from "./goals";
import { getIncomeVsSpend } from "./income";

export interface Insight {
  severity: "alert" | "warn" | "good" | "info";
  title: string;
  detail: string;
  category?: string;
}

const SEVERITY_ORDER: Record<Insight["severity"], number> = {
  alert: 0,
  warn: 1,
  good: 2,
  info: 3,
};

const fmt = (v: number) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(v);

interface CatTotal {
  cat: string;
  total: number;
}

// Rule-based, fully local insights over the LATEST data month (not the calendar
// month — data may lag). Covers goals, month-over-month category moves, net
// cashflow, and large one-offs. Returns highest-severity first.
export function getInsights(): Insight[] {
  const db = getDb();
  const insights: Insight[] = [];

  const months = (
    db
      .prepare(
        `SELECT DISTINCT substr(txn_date, 1, 7) m FROM v_transactions
         WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
         ORDER BY m DESC LIMIT 2`
      )
      .all() as { m: string }[]
  ).map((r) => r.m);

  if (months.length === 0) return insights;
  const cur = months[0];
  const prev = months[1] as string | undefined;

  const catTotals = (month: string) =>
    db
      .prepare(
        `SELECT effective_category cat, SUM(amount) total FROM v_transactions
         WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
           AND substr(txn_date, 1, 7) = ? GROUP BY cat`
      )
      .all(month) as CatTotal[];

  const curCats = catTotals(cur);
  const prevMap = new Map((prev ? catTotals(prev) : []).map((r) => [r.cat, r.total]));

  // 1. Month-over-month category moves (material: >=25% and >=$75).
  if (prev) {
    for (const c of curCats) {
      const p = prevMap.get(c.cat) ?? 0;
      if (p <= 0) continue;
      const diff = c.total - p;
      const pct = (diff / p) * 100;
      if (Math.abs(diff) >= 75 && Math.abs(pct) >= 25) {
        insights.push({
          severity: diff > 0 ? "warn" : "good",
          category: c.cat,
          title: `${c.cat} ${diff > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}% in ${cur}`,
          detail: `${fmt(p)} → ${fmt(c.total)} vs ${prev}`,
        });
      }
    }
  }

  // 2. Goals vs the latest data month.
  for (const g of listGoals()) {
    const spent = curCats.find((c) => c.cat === g.category)?.total ?? 0;
    const pct = g.monthly_limit > 0 ? (spent / g.monthly_limit) * 100 : 0;
    if (pct > 100) {
      insights.push({
        severity: "alert",
        category: g.category,
        title: `${g.category} over budget`,
        detail: `${fmt(spent)} of ${fmt(g.monthly_limit)} (${pct.toFixed(0)}%) in ${cur}`,
      });
    } else if (pct >= 80) {
      insights.push({
        severity: "warn",
        category: g.category,
        title: `${g.category} near budget`,
        detail: `${fmt(spent)} of ${fmt(g.monthly_limit)} (${pct.toFixed(0)}%) in ${cur}`,
      });
    }
  }

  // 3. Net cashflow for the latest month with income data.
  const ivs = getIncomeVsSpend();
  const curIvs = ivs.find((m) => m.month === cur && m.income > 0);
  if (curIvs) {
    const net = curIvs.income - curIvs.fixed - curIvs.variable;
    if (net < 0) {
      insights.push({
        severity: "alert",
        title: `Spent more than earned in ${cur}`,
        detail: `Net ${fmt(net)} — income ${fmt(curIvs.income)}, expenses ${fmt(curIvs.fixed + curIvs.variable)}`,
      });
    } else {
      insights.push({
        severity: "good",
        title: `Saved ${fmt(net)} in ${cur}`,
        detail: `Income ${fmt(curIvs.income)} − expenses ${fmt(curIvs.fixed + curIvs.variable)}`,
      });
    }
  }

  // 4. Large one-offs in the latest month.
  const oneoffs = db
    .prepare(
      `SELECT description, amount FROM v_transactions
       WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
         AND substr(txn_date, 1, 7) = ? AND amount >= 300
       ORDER BY amount DESC`
    )
    .all(cur) as { description: string; amount: number }[];
  if (oneoffs.length) {
    const sum = oneoffs.reduce((s, o) => s + o.amount, 0);
    const top = oneoffs[0].description.trim().replace(/\s+/g, " ").slice(0, 28);
    insights.push({
      severity: "info",
      title: `${oneoffs.length} large one-off${oneoffs.length > 1 ? "s" : ""} in ${cur}`,
      detail: `${fmt(sum)} total · biggest: ${top} ${fmt(oneoffs[0].amount)}`,
    });
  }

  // 5. Forward look at the current CALENDAR month (the one heuristic that
  // does NOT use the latest data month): projected net, and — when partial
  // current-month data exists — categories pacing materially over typical
  // (same 25% / $75 materiality as the MoM rule).
  const fc = getForecast();
  if (fc) {
    if (fc.mode === "pace") {
      for (const c of fc.categories) {
        const over = c.projected - c.typical;
        if (c.typical > 0 && over >= 75 && over / c.typical >= 0.25) {
          insights.push({
            severity: "warn",
            category: c.category,
            title: `${c.category} pacing ${fmt(over)} over usual`,
            detail: `${fmt(c.soFar)} by day ${fc.daysOfData} → ${fmt(c.projected)} projected vs ${fmt(c.typical)} typical`,
          });
        }
      }
    }
    insights.push({
      severity: fc.projectedNet >= 0 ? "info" : "warn",
      title: `${fc.targetMonth} on track for ${fc.projectedNet >= 0 ? "+" : "−"}${fmt(Math.abs(fc.projectedNet))} net`,
      detail:
        fc.mode === "pace"
          ? `paced from ${fc.daysOfData} days of data · payroll ${fmt(fc.projectedIncome)}`
          : `from last ${fc.basisMonths.length} complete months · payroll ${fmt(fc.projectedIncome)} − fixed ${fmt(fc.projectedFixed)} − variable ${fmt(fc.projectedVariable)}`,
    });
  }

  // 6. Biggest category this month (context).
  if (curCats.length) {
    const top = [...curCats].sort((a, b) => b.total - a.total)[0];
    insights.push({
      severity: "info",
      category: top.cat,
      title: `Top category in ${cur}: ${top.cat}`,
      detail: `${fmt(top.total)}`,
    });
  }

  return insights.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}
