"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PALETTE } from "@/lib/colors";
import { formatCurrency, formatDayShort } from "@/lib/format";
import { deriveSafeToSpend } from "@/lib/safe-to-spend";
import type { CashflowForecast } from "./forecast-tab";

// The anti-bank-app number: one calm figure at the top of the dashboard that
// answers "am I clear through rent until the next payday" so the user never
// has to open their bank app with one eye closed. Derived client-side from
// the cashflow forecast the dashboard already fetched — see lib/safe-to-spend.ts.

const STATUS_COLOR: Record<string, string | undefined> = {
  clear: PALETTE.sage,
  tight: PALETTE.mustard,
  short: PALETTE.terracotta,
};

export function SafeToSpendHero({
  cashForecast,
}: {
  cashForecast: CashflowForecast | null;
}) {
  const s = useMemo(
    () => (cashForecast ? deriveSafeToSpend(cashForecast) : null),
    [cashForecast]
  );

  if (!s) return null;

  if (s.status === "stale") {
    return (
      <div className="mb-6 border border-border px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
          SAFE TO SPEND — FORECAST ANCHOR IS {s.staleDays}D OLD
        </p>
        <Link
          href="/upload"
          className="font-mono text-xs tracking-widest uppercase underline underline-offset-4 hover:text-foreground text-muted-foreground"
        >
          UPLOAD A CHEQUING STATEMENT
        </Link>
      </div>
    );
  }

  const color = STATUS_COLOR[s.status];
  const paydayPhrase =
    s.windowEndKind === "payroll"
      ? `payday ${formatDayShort(s.windowEnd)}`
      : `the next ${s.daysInWindow} days`;

  return (
    <div className="mb-6 border border-border">
      <div className="flex flex-col md:flex-row md:items-stretch">
        <div className="p-4 md:p-6 md:flex-1">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            {s.status === "short" ? "PROJECTED SHORT" : "SAFE TO SPEND"}
          </h2>
          <p className="font-mono text-4xl md:text-5xl font-bold" style={{ color }}>
            {formatCurrency(Math.abs(s.cushion))}
          </p>
          <p className="text-xs text-muted-foreground mt-2 max-w-md">
            {s.status === "short" ? (
              <>
                The forecast dips {formatCurrency(Math.abs(s.cushion))} below
                zero around {formatDayShort(s.lowestDate)}, before {paydayPhrase}.
                Moving that much in, or holding off on non-essentials, clears it.
              </>
            ) : (
              <>
                {s.nextFixed
                  ? `Clear through rent + bills on ${formatDayShort(s.nextFixed.date)}`
                  : "No rent due in this window"}{" "}
                and on to {paydayPhrase} — about {formatCurrency(s.perDay)}/day
                on top of your usual spending.
                {s.status === "tight" &&
                  " It's tight: normal month-to-month swings could cross zero."}
              </>
            )}
          </p>
        </div>
        <div className="border-t md:border-t-0 md:border-l border-border px-4 py-3 md:p-6 flex md:flex-col items-center md:items-end justify-between gap-2 md:justify-center md:gap-1">
          <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            LOWEST {formatCurrency(s.cushion)} · {formatDayShort(s.lowestDate)}
          </p>
          <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            ESTIMATE — SEE FORECAST TAB
            {s.staleDays > 0 ? ` · ANCHOR ${s.staleDays}D OLD` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
