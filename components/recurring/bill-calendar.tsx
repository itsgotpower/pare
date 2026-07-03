"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { PALETTE } from "@/lib/colors";
import { formatCurrency, formatCents, formatDayShort } from "@/lib/format";

// Mirrors lib/db/billCalendar.ts (BillCalendar). Kept local so the component is
// a drop-in with no shared-type coupling beyond the JSON shape.
type BillStatus = "ok" | "tight" | "short";
interface UpcomingBill {
  date: string;
  label: string;
  amount: number;
  projectedBalance: number;
  projectedLow: number;
  status: BillStatus;
}
interface BillCalendarData {
  available: boolean;
  today: string;
  windowDays: number;
  anchor: { date: string; balance: number; period: string } | null;
  staleDays: number | null;
  bills: UpcomingBill[];
  totalDue: number;
  nextPayday: { date: string; amount: number } | null;
  firstShortfall: UpcomingBill | null;
  lowestBalance: { date: string; balance: number } | null;
}

const STATUS_COLOR: Record<BillStatus, string> = {
  ok: PALETTE.sage,
  tight: PALETTE.mustard,
  short: PALETTE.terracotta,
};

// Whole days between two YYYY-MM-DD strings (local midnight), b − a.
const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) /
      86400000
  );

const relDay = (today: string, date: string) => {
  const n = daysBetween(today, date);
  if (n <= 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n}d`;
};

export function BillCalendar() {
  const [data, setData] = useState<BillCalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/summary?type=bill_calendar")
      .then((r) => {
        if (!r.ok) throw new Error(`request failed (${r.status})`);
        return r.json();
      })
      .then((d: BillCalendarData) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "request failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="h-40 border border-border bg-card animate-pulse mb-6" aria-hidden />;
  }

  if (error && !data) {
    return (
      <div className="border border-border bg-card py-10 text-center mb-6">
        <p className="font-mono text-sm text-destructive">
          COULDN&apos;T LOAD BILL CALENDAR — {error.toUpperCase()}
        </p>
      </div>
    );
  }

  // No reconciled chequing anchor → no balance to warn against. Say what unlocks
  // it rather than showing a calendar we can't reason about.
  if (!data || !data.available) {
    return (
      <div className="border border-border bg-card p-6 mb-6">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2 flex items-center gap-2">
          <CalendarClock className="size-3.5" /> UPCOMING BILLS
        </h2>
        <p className="text-sm text-muted-foreground">
          Upload a chequing statement to project upcoming bill due-dates against
          your balance and get low-balance warnings.
        </p>
      </div>
    );
  }

  const { bills, firstShortfall, lowestBalance, nextPayday } = data;

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
          <CalendarClock className="size-3.5" /> UPCOMING BILLS
        </h2>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          NEXT {data.windowDays} DAYS
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Rent, fixed bills, and detected subscriptions projected against your
        latest chequing balance. Estimate — statements lag the calendar
        {data.staleDays != null && data.staleDays > 0
          ? ` (anchored ${data.staleDays}d ago)`
          : ""}
        .
      </p>

      {/* Low-balance warning */}
      {firstShortfall && (
        <div
          className="flex items-start gap-2.5 border px-3 py-2.5 mb-[1px]"
          style={{ borderColor: PALETTE.terracotta }}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            style={{ color: PALETTE.terracotta }}
          />
          <p className="text-xs">
            <span className="font-medium" style={{ color: PALETTE.terracotta }}>
              Balance may not cover {firstShortfall.label}
            </span>{" "}
            <span className="text-muted-foreground">
              on {formatDayShort(firstShortfall.date)} — projected to{" "}
              {formatCurrency(firstShortfall.projectedBalance)} that day.
            </span>
          </p>
        </div>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-[1px] bg-border border border-border mb-[1px]">
        <div className="bg-card p-4">
          <h3 className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5">
            TOTAL DUE
          </h3>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {formatCurrency(data.totalDue)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {bills.length} bill{bills.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="bg-card p-4">
          <h3 className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5">
            LOWEST BALANCE
          </h3>
          <p
            className="font-mono text-2xl font-bold tabular-nums"
            style={{
              color:
                lowestBalance && lowestBalance.balance < 0
                  ? PALETTE.terracotta
                  : undefined,
            }}
          >
            {lowestBalance ? formatCurrency(lowestBalance.balance) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {lowestBalance ? formatDayShort(lowestBalance.date) : "in window"}
          </p>
        </div>
        <div className="bg-card p-4 col-span-2 md:col-span-1">
          <h3 className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-1.5">
            NEXT PAYDAY
          </h3>
          <p className="font-mono text-2xl font-bold tabular-nums">
            {nextPayday ? formatDayShort(nextPayday.date) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {nextPayday ? `+${formatCurrency(nextPayday.amount)}` : "none in window"}
          </p>
        </div>
      </div>

      {/* Bill agenda */}
      {bills.length === 0 ? (
        <div className="border border-border bg-card p-6 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            NO BILLS DUE IN THE NEXT {data.windowDays} DAYS
          </p>
        </div>
      ) : (
        <div className="border border-border bg-card divide-y divide-border">
          {bills.map((b, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <span
                className="inline-block w-1.5 h-8 shrink-0"
                style={{ backgroundColor: STATUS_COLOR[b.status] }}
                title={
                  b.status === "short"
                    ? "Projected balance goes negative"
                    : b.status === "tight"
                    ? "Cutting it close — within the uncertainty band"
                    : "Covered"
                }
              />
              <div className="w-16 shrink-0">
                <p className="font-mono text-sm font-medium tabular-nums">
                  {formatDayShort(b.date)}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground uppercase">
                  {relDay(data.today, b.date)}
                </p>
              </div>
              <p className="flex-1 text-sm truncate">{b.label}</p>
              <div className="text-right shrink-0">
                <p className="font-mono text-sm font-medium tabular-nums">
                  −{formatCents(b.amount)}
                </p>
                <p
                  className="font-mono text-[10px] tabular-nums"
                  style={{
                    color:
                      b.status === "ok" ? "var(--muted-foreground)" : STATUS_COLOR[b.status],
                  }}
                >
                  {formatCurrency(b.projectedBalance)} after
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
