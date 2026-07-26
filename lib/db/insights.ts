import { getDb } from "../db";
import { merchantDisplay, merchantSlug } from "../merchant-key";
import { SPEND_WHERE } from "./account-kinds";
import { getForecast } from "./forecast";
import { listGoals } from "./goals";
import { getIncomeVsSpend } from "./income";
import { median } from "./stats";
import { getSubscriptions } from "./subscriptions";

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

// Unusual one-off charge detection (insight #5) — a single charge is an
// anomaly RELATIVE to its own merchant's (or, lacking merchant history, its
// category's) prior charges. Tuning constants, documented in one place:
//
// Merchant-relative (preferred when the merchant has enough history):
const ANOMALY_MERCHANT_MIN_CHARGES = 3; // prior charges needed before the latest month
const ANOMALY_MERCHANT_RATIO = 2.5; // flag at >= ratio × the merchant's prior median…
const ANOMALY_MERCHANT_MIN_DELTA = 50; // …AND at least $50 over that median
// Category-relative fallback (new-ish merchant, judge vs the category):
const ANOMALY_CATEGORY_WINDOW_MONTHS = 6; // pool = individual charges over the prior 6 months
const ANOMALY_CATEGORY_MIN_CHARGES = 8; // pool must have >= 8 charges to trust mean/σ
const ANOMALY_CATEGORY_SIGMA = 2; // flag above mean + 2σ (population σ)…
const ANOMALY_CATEGORY_MIN_AMOUNT = 75; // …AND at least $75 absolute
// Shared:
const ANOMALY_MAX = 3; // top N flagged charges by amount (one per merchant)
const ANOMALY_ALERT_FACTOR = 2; // "alert" severity at >= 2× the flagging threshold

interface CatTotal {
  cat: string;
  total: number;
}

// Rule-based, fully local insights over the LATEST data month (not the calendar
// month — data may lag). Covers goals, month-over-month category moves, net
// cashflow, large one-offs, and unusual (history-relative) one-off charges.
// Returns highest-severity first.
export function getInsights(): Insight[] {
  const db = getDb();
  const insights: Insight[] = [];

  const months = (
    db
      .prepare(
        `SELECT DISTINCT substr(txn_date, 1, 7) m FROM v_transactions
         WHERE ${SPEND_WHERE}
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
        // Slice view: split parts count under their own categories.
        `SELECT effective_category cat, SUM(amount) total FROM v_category_slices
         WHERE ${SPEND_WHERE}
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
       WHERE ${SPEND_WHERE}
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

  // 5. Unusual one-off charges: single charges in the latest month that are
  // outliers vs that MERCHANT's (or, without enough merchant history, that
  // CATEGORY's) own prior charges. Complements #4, which flags absolutely-large
  // charges — this one is relative, so a $180 charge at a merchant that
  // usually runs $40 flags here even though it never clears the $300 bar.
  // Detected subscriptions are excluded (a known recurring charge is never a
  // one-off; their anomalies are #7's price-hike / still-charging rules).
  // Parent rows, not slices — this is about single charges. Constants + their
  // meanings live next to `fmt` above.
  const subscriptions = getSubscriptions().subscriptions;
  {
    const subSlugs = new Set(subscriptions.map((s) => s.slug));

    const curRows = db
      .prepare(
        `SELECT description, amount, effective_category cat FROM v_transactions
         WHERE ${SPEND_WHERE} AND amount > 0 AND substr(txn_date, 1, 7) = ?`
      )
      .all(cur) as { description: string; amount: number; cat: string }[];
    const priorRows = db
      .prepare(
        `SELECT description, amount, substr(txn_date, 1, 7) m, effective_category cat
         FROM v_transactions
         WHERE ${SPEND_WHERE} AND amount > 0 AND substr(txn_date, 1, 7) < ?`
      )
      .all(cur) as { description: string; amount: number; m: string; cat: string }[];

    // First YYYY-MM inside the category window (the N months before `cur`).
    const [cy, cm] = cur.split("-").map(Number);
    const winStart = new Date(cy, cm - 1 - ANOMALY_CATEGORY_WINDOW_MONTHS, 1);
    const catMinMonth = `${winStart.getFullYear()}-${String(winStart.getMonth() + 1).padStart(2, "0")}`;

    const bySlug = new Map<string, number[]>(); // all prior charges per merchant
    const byCat = new Map<string, number[]>(); // windowed prior charges per category
    for (const r of priorRows) {
      const slug = merchantSlug(r.description);
      let g = bySlug.get(slug);
      if (!g) bySlug.set(slug, (g = []));
      g.push(r.amount);
      if (r.m >= catMinMonth) {
        let c = byCat.get(r.cat);
        if (!c) byCat.set(r.cat, (c = []));
        c.push(r.amount);
      }
    }

    interface Flagged {
      slug: string;
      description: string;
      amount: number;
      cat: string;
      severity: "alert" | "warn";
      detail: string;
    }
    const flagged: Flagged[] = [];
    for (const r of curRows) {
      const slug = merchantSlug(r.description);
      if (subSlugs.has(slug)) continue;

      const hist = bySlug.get(slug) ?? [];
      if (hist.length >= ANOMALY_MERCHANT_MIN_CHARGES) {
        const med = median(hist);
        const threshold = Math.max(
          med * ANOMALY_MERCHANT_RATIO,
          med + ANOMALY_MERCHANT_MIN_DELTA
        );
        if (med > 0 && r.amount >= threshold) {
          flagged.push({
            slug,
            description: r.description,
            amount: r.amount,
            cat: r.cat,
            severity: r.amount >= threshold * ANOMALY_ALERT_FACTOR ? "alert" : "warn",
            detail: `${(r.amount / med).toFixed(1)}× your typical ${fmt(med)} at this merchant (${hist.length} prior charges)`,
          });
        }
      } else {
        const pool = byCat.get(r.cat) ?? [];
        if (
          pool.length >= ANOMALY_CATEGORY_MIN_CHARGES &&
          r.amount >= ANOMALY_CATEGORY_MIN_AMOUNT
        ) {
          const mean = pool.reduce((s, a) => s + a, 0) / pool.length;
          const sigma = Math.sqrt(
            pool.reduce((s, a) => s + (a - mean) ** 2, 0) / pool.length
          );
          const threshold = mean + ANOMALY_CATEGORY_SIGMA * sigma;
          if (r.amount > threshold) {
            flagged.push({
              slug,
              description: r.description,
              amount: r.amount,
              cat: r.cat,
              severity: r.amount >= threshold * ANOMALY_ALERT_FACTOR ? "alert" : "warn",
              detail: `well above your usual ${r.cat} charge of ~${fmt(mean)}`,
            });
          }
        }
      }
    }

    // One flag per merchant (keep its biggest charge), then the top N by amount.
    const bestPerSlug = new Map<string, Flagged>();
    for (const f of flagged) {
      const prior = bestPerSlug.get(f.slug);
      if (!prior || f.amount > prior.amount) bestPerSlug.set(f.slug, f);
    }
    const top = [...bestPerSlug.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, ANOMALY_MAX);
    for (const f of top) {
      insights.push({
        severity: f.severity,
        category: f.cat,
        title: `Unusual charge: ${fmt(f.amount)} at ${merchantDisplay(f.description)}`,
        detail: f.detail,
      });
    }
  }

  // 6. Forward look at the current CALENDAR month (the one heuristic that
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

  // 7. Subscription anomalies: price hikes and marked-to-cancel subs that
  // are still charging. Both come straight from the recurring detector
  // (fetched once, up in #5).
  for (const sub of subscriptions) {
    if (sub.priceChange && sub.priceChange.pct > 0 && !sub.lapsed) {
      insights.push({
        severity: "warn",
        title: `${sub.merchant} price went up ${sub.priceChange.pct}%`,
        detail: `${fmt(sub.priceChange.from)} → ${fmt(sub.priceChange.to)} per charge — ${fmt((sub.priceChange.to - sub.priceChange.from) * 12)}/yr more if monthly`,
      });
    }
    if (sub.markedAt && sub.chargedSinceMark > 0 && !sub.lapsed) {
      insights.push({
        severity: "alert",
        title: `${sub.merchant} still charging after you marked it`,
        detail: `${fmt(sub.chargedSinceMark)} since ${sub.markedAt} — cancel it to stop the bleed`,
      });
    }
  }

  // 8. Biggest category this month (context).
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
