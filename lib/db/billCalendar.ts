import { getCashflowForecast } from "./cashflowForecast";

// Bill calendar: the upcoming committed OUTFLOWS (rent + fixed bills + detected
// subscriptions) over the next `windowDays`, each cross-checked against the
// cash-flow forecast so we can warn when the projected balance won't cover a
// bill. This is a pure DERIVATION over getCashflowForecast() — that engine
// already schedules every bill event (on its own cadence) and projects the
// chequing balance forward daily with an uncertainty band, so the calendar
// reuses both instead of re-deriving cadences.
//
// Like the forecast it sits on, this is an ESTIMATE anchored at the latest
// reconciled chequing closing balance (statements lag the calendar). With no
// chequing anchor there is no balance to check, so the feature reports
// `available: false` rather than listing due dates it can't reason about — the
// low-balance warning is the whole point.

// Coverage of a single bill, from the forecast band on its due date:
//   ok    — even the low edge of the band stays >= 0
//   tight — the central projection covers it, but the low edge dips below 0
//   short — the central projection itself goes negative on/at this bill
export type BillStatus = "ok" | "tight" | "short";

export interface UpcomingBill {
  date: string; // YYYY-MM-DD
  label: string;
  amount: number; // positive dollars due
  projectedBalance: number; // central forecast balance on this date (post-bill)
  projectedLow: number; // low edge of the ±1σ band on this date
  status: BillStatus;
}

export interface BillCalendar {
  available: boolean; // false when there's no reconciled chequing anchor
  today: string; // YYYY-MM-DD (local)
  windowDays: number;
  anchor: { date: string; balance: number; period: string } | null;
  staleDays: number | null; // days since the anchor's closing date
  bills: UpcomingBill[]; // ascending by date, within the window
  totalDue: number; // sum of bill amounts in the window
  nextPayday: { date: string; amount: number } | null; // next inflow in window
  firstShortfall: UpcomingBill | null; // earliest bill with status 'short'
  lowestBalance: { date: string; balance: number } | null; // min over the window
}

const DEFAULT_WINDOW_DAYS = 45;

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

function empty(windowDays: number, today: string): BillCalendar {
  return {
    available: false,
    today,
    windowDays,
    anchor: null,
    staleDays: null,
    bills: [],
    totalDue: 0,
    nextPayday: null,
    firstShortfall: null,
    lowestBalance: null,
  };
}

export function getBillCalendar(
  now: Date = new Date(),
  windowDays: number = DEFAULT_WINDOW_DAYS
): BillCalendar {
  const today = fmt(now);

  const fc = getCashflowForecast(now);
  if (!fc) return empty(windowDays, today);

  const windowEnd = fmt(addDays(now, windowDays));
  // The forecast is daily from anchor+1..anchor+90; every day in that range has
  // a point, and every scheduled event falls on one of those days. Guarding on
  // the last point date keeps us safe if the anchor is so stale the window runs
  // past the 90-day horizon.
  const pointByDate = new Map(fc.points.map((p) => [p.date, p]));
  const lastPointDate = fc.points[fc.points.length - 1].date;
  const horizonEnd = windowEnd < lastPointDate ? windowEnd : lastPointDate;

  const bills: UpcomingBill[] = [];
  for (const e of fc.events) {
    if (e.amount >= 0) continue; // inflows handled separately (nextPayday)
    if (e.date < today || e.date > horizonEnd) continue;
    const p = pointByDate.get(e.date);
    if (!p) continue; // defensive; shouldn't happen inside the horizon
    const status: BillStatus =
      p.balance < 0 ? "short" : p.low < 0 ? "tight" : "ok";
    bills.push({
      date: e.date,
      label: e.label,
      amount: Math.abs(e.amount),
      projectedBalance: p.balance,
      projectedLow: p.low,
      status,
    });
  }
  bills.sort((a, b) => a.date.localeCompare(b.date));

  const totalDue = Math.round(bills.reduce((s, b) => s + b.amount, 0) * 100) / 100;
  const firstShortfall = bills.find((b) => b.status === "short") ?? null;

  const payEvent = fc.events.find(
    (e) => e.amount > 0 && e.date >= today && e.date <= horizonEnd
  );
  const nextPayday = payEvent
    ? { date: payEvent.date, amount: payEvent.amount }
    : null;

  // Lowest projected balance across the visible window (>= today).
  let lowestBalance: { date: string; balance: number } | null = null;
  for (const p of fc.points) {
    if (p.date < today || p.date > horizonEnd) continue;
    if (!lowestBalance || p.balance < lowestBalance.balance)
      lowestBalance = { date: p.date, balance: p.balance };
  }

  return {
    available: true,
    today,
    windowDays,
    anchor: fc.anchor,
    staleDays: fc.staleDays,
    bills,
    totalDue,
    nextPayday,
    firstShortfall,
    lowestBalance,
  };
}
