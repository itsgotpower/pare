import { getDb } from "../db";
import { getIncomeVsSpend, FIXED_CATEGORY_LIST } from "./income";
import { getSubscriptions } from "./subscriptions";

// Cash-flow forecast (30/60/90 days): project the last RECONCILED chequing
// closing balance (statements.closing_balance, written at upload from the
// parser's balance-reconciled walk) forward day by day. This is an ESTIMATE —
// statements lag the calendar, so the projection starts at the statement's
// closing date, not today.
//
// Composition (buckets are disjoint by construction):
//   + payroll      — discrete deposits; median amount of the last deposits,
//                    cadence from the median gap between them
//   − fixed        — rent + utilities + chequing fees (the income.ts fixed
//                    bucket), one monthly event on the observed rent day
//   − subscriptions— detected recurring card spend (lib/db/subscriptions.ts),
//                    each projected on its own cadence from its last charge;
//                    fixed-category subs (e.g. Telus) stay in the fixed bucket,
//                    irregular ones stay in the discretionary baseline
//   − discretionary— median monthly variable spend minus the scheduled
//                    subscriptions, drained daily
//
// Card spend is treated as if it left chequing the day it happens (in reality
// it leaves in a later card-payment lump) — fine for a horizon estimate.
// One-off income (refunds, winnings) is deliberately excluded, like forecast.ts.
//
// Uncertainty band: ±1σ of monthly variable spend, growing with sqrt(t) —
// day-to-day spending noise compounds over the horizon.

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  balance: number;
  low: number;
  high: number;
}

export interface ForecastEvent {
  date: string;
  label: string;
  amount: number; // signed: + inflow, − outflow
}

export interface HorizonSummary {
  days: number; // 30 | 60 | 90
  endBalance: number;
  endLow: number;
  endHigh: number;
  minBalance: number;
  minDate: string;
}

export interface CashflowForecast {
  anchor: { date: string; balance: number; period: string };
  staleDays: number; // days between anchor closing date and "now"
  points: ForecastPoint[]; // daily, days 1..90 after the anchor
  events: ForecastEvent[]; // discrete scheduled events inside the window
  horizons: HorizonSummary[];
  assumptions: {
    payrollAmount: number;
    payrollEveryDays: number;
    fixedMonthly: number;
    fixedDayOfMonth: number;
    recurringMonthly: number; // cadence-scheduled subscriptions
    discretionaryMonthly: number;
    sigmaMonthly: number;
    basisMonths: string[];
  };
}

const HORIZON_DAYS = 90;
const DAYS_PER_MONTH = 30.44;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const toDate = (s: string) => new Date(s + "T00:00:00");
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
// setDate (not +ms) so DST shifts can't repeat or skip a calendar day.
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function getCashflowForecast(now: Date = new Date()): CashflowForecast | null {
  const db = getDb();

  const anchor = db
    .prepare(
      `SELECT period, closing_balance AS balance, closing_date AS date
       FROM statements
       WHERE source = 'cibc_chequing'
         AND closing_balance IS NOT NULL AND closing_date IS NOT NULL
       ORDER BY closing_date DESC LIMIT 1`
    )
    .get() as { period: string; balance: number; date: string } | undefined;
  if (!anchor) return null;

  const complete = getIncomeVsSpend().filter((m) => m.income > 0);
  if (complete.length === 0) return null;
  const basis = complete.slice(-3);
  const basisMonths = basis.map((m) => m.month);

  // Payroll: median net deposit + median gap between the recent deposits.
  const pays = db
    .prepare(
      `SELECT txn_date, amount FROM v_transactions
       WHERE flow = 'income'
         AND (UPPER(description) LIKE '%PEOPLE CENTER%' OR UPPER(description) LIKE '%PAYROLL%')
       ORDER BY txn_date`
    )
    .all() as { txn_date: string; amount: number }[];
  const recentPays = pays.slice(-8);
  const payrollAmount = recentPays.length
    ? round2(median(recentPays.map((p) => p.amount)))
    : 0;
  let payrollEveryDays = 14;
  if (recentPays.length >= 2) {
    const times = recentPays.map((p) => toDate(p.txn_date).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++)
      gaps.push((times[i] - times[i - 1]) / 86400000);
    payrollEveryDays = Math.min(35, Math.max(7, Math.round(median(gaps))));
  }

  // Fixed bucket = income.ts fixed (rent + utilities + chequing fees), as one
  // monthly event on the observed rent day — rent dominates the bucket.
  const fixedMonthly = round2(median(basis.map((m) => m.fixed)));
  const rentDays = db
    .prepare(
      `SELECT CAST(substr(txn_date, 9, 2) AS INTEGER) AS day
       FROM v_transactions
       WHERE effective_category = 'Rent / housing'
       ORDER BY txn_date DESC LIMIT 6`
    )
    .all() as { day: number }[];
  const fixedDayOfMonth = rentDays.length
    ? Math.round(median(rentDays.map((r) => r.day)))
    : 1;

  // Subscriptions on a real cadence get discrete events; fixed-category ones
  // are already inside fixedMonthly and irregular ones stay in discretionary.
  const fixedSet = new Set<string>(FIXED_CATEGORY_LIST);
  const CADENCE_DAYS: Record<string, number> = {
    weekly: 7,
    biweekly: 14,
    "every ~2 months": 61,
  };
  const scheduled = getSubscriptions().subscriptions.filter(
    (s) => !fixedSet.has(s.category) && s.frequency !== "irregular"
  );
  const recurringMonthly = round2(
    scheduled.reduce((s, x) => s + x.monthlyCost, 0)
  );

  const medianVariable = median(basis.map((m) => m.variable));
  const discretionaryMonthly = round2(
    Math.max(0, medianVariable - recurringMonthly)
  );
  const dailyDiscretionary = discretionaryMonthly / DAYS_PER_MONTH;

  // Band width: stddev of monthly variable spend over recent complete months.
  const sigmaBasis = complete.slice(-6).map((m) => m.variable);
  let sigmaMonthly: number;
  if (sigmaBasis.length >= 2) {
    const mean = sigmaBasis.reduce((s, x) => s + x, 0) / sigmaBasis.length;
    sigmaMonthly = Math.sqrt(
      sigmaBasis.reduce((s, x) => s + (x - mean) ** 2, 0) /
        (sigmaBasis.length - 1)
    );
  } else {
    sigmaMonthly = 0.2 * medianVariable;
  }
  sigmaMonthly = round2(sigmaMonthly);

  // Discrete event schedule inside (anchor, anchor + 90d].
  const anchorDate = toDate(anchor.date);
  const endDate = addDays(anchorDate, HORIZON_DAYS);
  const events: ForecastEvent[] = [];
  const push = (d: Date, label: string, amount: number) => {
    if (d > anchorDate && d <= endDate)
      events.push({ date: fmt(d), label, amount: round2(amount) });
  };

  if (payrollAmount > 0 && pays.length) {
    let t = toDate(pays[pays.length - 1].txn_date);
    for (let i = 0; i < 60 && t <= endDate; i++) {
      t = addDays(t, payrollEveryDays);
      push(t, "Payroll", payrollAmount);
    }
  }

  if (fixedMonthly > 0) {
    let y = anchorDate.getFullYear();
    let m = anchorDate.getMonth();
    for (let i = 0; i < 5; i++) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      push(
        new Date(y, m, Math.min(fixedDayOfMonth, daysInMonth)),
        "Rent + fixed bills",
        -fixedMonthly
      );
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }

  for (const sub of scheduled) {
    const last = toDate(sub.lastDate);
    if (sub.frequency === "monthly") {
      const day = last.getDate();
      let y = last.getFullYear();
      let m = last.getMonth();
      for (let i = 0; i < 12; i++) {
        m++;
        if (m > 11) { m = 0; y++; }
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const d = new Date(y, m, Math.min(day, daysInMonth));
        if (d > endDate) break;
        push(d, sub.merchant, -sub.typical);
      }
    } else {
      const step = CADENCE_DAYS[sub.frequency] ?? 30;
      let t = last;
      for (let i = 0; i < 90 && t <= endDate; i++) {
        t = addDays(t, step);
        push(t, sub.merchant, -sub.typical);
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const eventDelta = new Map<string, number>();
  for (const e of events)
    eventDelta.set(e.date, (eventDelta.get(e.date) || 0) + e.amount);

  // Daily walk with the sqrt(t) band.
  const points: ForecastPoint[] = [];
  let balance = anchor.balance;
  for (let d = 1; d <= HORIZON_DAYS; d++) {
    const date = fmt(addDays(anchorDate, d));
    balance += (eventDelta.get(date) || 0) - dailyDiscretionary;
    const band = sigmaMonthly * Math.sqrt(d / DAYS_PER_MONTH);
    points.push({
      date,
      balance: round2(balance),
      low: round2(balance - band),
      high: round2(balance + band),
    });
  }

  const horizons: HorizonSummary[] = [30, 60, 90].map((days) => {
    const slice = points.slice(0, days);
    const end = slice[slice.length - 1];
    let min = slice[0];
    for (const p of slice) if (p.balance < min.balance) min = p;
    return {
      days,
      endBalance: end.balance,
      endLow: end.low,
      endHigh: end.high,
      minBalance: min.balance,
      minDate: min.date,
    };
  });

  const staleDays = Math.max(
    0,
    Math.round((now.getTime() - anchorDate.getTime()) / 86400000)
  );

  return {
    anchor: { date: anchor.date, balance: anchor.balance, period: anchor.period },
    staleDays,
    points,
    events,
    horizons,
    assumptions: {
      payrollAmount,
      payrollEveryDays,
      fixedMonthly,
      fixedDayOfMonth,
      recurringMonthly,
      discretionaryMonthly,
      sigmaMonthly,
      basisMonths,
    },
  };
}
