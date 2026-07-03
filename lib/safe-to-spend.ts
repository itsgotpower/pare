// Safe-to-spend: how much cushion is left between today and the next payday
// AFTER the next rent + fixed-bills event, derived from an existing
// CashflowForecast payload (lib/db/cashflowForecast.ts).
//
// Pure module — no DB, no React. The dashboard hero card derives it
// client-side from the already-fetched forecast; the upload route derives it
// server-side to push a heads-up when the projection dips below zero.
//
// The window ends at the first payroll after the next rent event because
// that deposit replenishes the balance — the question the number answers is
// "do I clear rent and make it to the next payday". With no rent event in
// the projection the window is the next payday after today; with no payroll
// at all it falls back to 30 days out.
//
// Status reuses the forecast's own ±1σ band (each point's `low`):
//   short — lowest projected balance in the window is below zero
//   tight — balance stays positive but its ±1σ low crosses zero
//   clear — even the low edge of the band stays above zero
//   stale — today is past the end of the projection (anchor too old)

interface Point {
  date: string; // YYYY-MM-DD
  balance: number;
  low: number;
}

interface Event {
  date: string;
  label: string;
  amount: number; // signed: + inflow, − outflow
}

export interface SafeToSpendForecast {
  anchor: { date: string; balance: number };
  staleDays: number;
  points: Point[];
  events: Event[];
}

export interface SafeToSpend {
  status: "clear" | "tight" | "short" | "stale";
  cushion: number; // lowest projected balance in the window (negative when short)
  perDay: number; // cushion spread over the window (0 when short)
  daysInWindow: number;
  windowEnd: string; // date the window closes
  windowEndKind: "payroll" | "horizon";
  nextFixed: { date: string; amount: number } | null; // next rent + fixed event
  lowestDate: string;
  asOf: string; // "today" used for the derivation
  staleDays: number;
  anchorDate: string;
}

// Label the cashflowForecast engine assigns its fixed-bucket events.
const FIXED_LABEL = "Rent + fixed bills";
const PAYROLL_LABEL = "Payroll";
const FALLBACK_WINDOW_DAYS = 30;

const round2 = (x: number) => Math.round(x * 100) / 100;

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

export function deriveSafeToSpend(
  fc: SafeToSpendForecast,
  now: Date = new Date()
): SafeToSpend | null {
  const { points, events } = fc;
  if (points.length === 0) return null;

  const today = fmt(now);
  const base = {
    asOf: today,
    staleDays: fc.staleDays,
    anchorDate: fc.anchor.date,
  };

  if (today > points[points.length - 1].date) {
    // The 90-day projection ended before today — nothing credible to show.
    return {
      ...base,
      status: "stale",
      cushion: 0,
      perDay: 0,
      daysInWindow: 0,
      windowEnd: points[points.length - 1].date,
      windowEndKind: "horizon",
      nextFixed: null,
      lowestDate: points[points.length - 1].date,
    };
  }

  // First projected day at or after today (index 0 when the anchor is fresh).
  let start = points.findIndex((p) => p.date >= today);
  if (start < 0) start = 0;

  const nextFixed =
    events.find((e) => e.label === FIXED_LABEL && e.date >= today) ?? null;
  const payAfter = events.find(
    (e) => e.label === PAYROLL_LABEL && e.date > (nextFixed?.date ?? today)
  );

  let windowEnd: string;
  let windowEndKind: SafeToSpend["windowEndKind"];
  if (payAfter) {
    windowEnd = payAfter.date;
    windowEndKind = "payroll";
  } else {
    windowEnd =
      points[Math.min(start + FALLBACK_WINDOW_DAYS - 1, points.length - 1)]
        .date;
    windowEndKind = "horizon";
  }

  let end = start;
  while (end + 1 < points.length && points[end + 1].date <= windowEnd) end++;

  let lowest = points[start];
  for (let i = start; i <= end; i++)
    if (points[i].balance < lowest.balance) lowest = points[i];

  const daysInWindow = end - start + 1;
  const cushion = round2(lowest.balance);
  const status: SafeToSpend["status"] =
    cushion < 0 ? "short" : lowest.low < 0 ? "tight" : "clear";

  return {
    ...base,
    status,
    cushion,
    perDay: cushion > 0 ? round2(cushion / daysInWindow) : 0,
    daysInWindow,
    windowEnd,
    windowEndKind,
    nextFixed: nextFixed
      ? { date: nextFixed.date, amount: nextFixed.amount }
      : null,
    lowestDate: lowest.date,
  };
}
