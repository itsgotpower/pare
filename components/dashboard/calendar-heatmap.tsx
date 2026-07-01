"use client";

import { useEffect, useMemo, useState } from "react";
import { PALETTE } from "@/lib/colors";
import { MONTH_NAMES, formatCurrency, formatMonthFull } from "@/lib/format";

export interface DailySpend {
  date: string; // YYYY-MM-DD
  total: number;
  count: number;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Local-time parse — new Date("YYYY-MM-DD") is UTC and can shift the weekday.
const parseDate = (s: string) =>
  new Date(parseInt(s.slice(0, 4)), parseInt(s.slice(5, 7)) - 1, parseInt(s.slice(8, 10)));

// Heat ramp: terracotta at varying alpha over the card background, so the
// scale survives dark mode. Intensity is anchored to the p95 of ALL days
// (not just the visible month) so months stay comparable as you navigate.
const HEAT = { r: 179, g: 101, b: 74 }; // PALETTE.terracotta

const heatColor = (alpha: number) =>
  `rgba(${HEAT.r}, ${HEAT.g}, ${HEAT.b}, ${alpha})`;

const LEGEND_STOPS = [0.12, 0.3, 0.55, 0.8, 1];

interface Props {
  days: DailySpend[];
  // When the parent's period filter selects a month we have data for, the
  // calendar follows it.
  syncMonth?: string | null;
}

export function CalendarHeatmap({ days, syncMonth }: Props) {
  const byDate = useMemo(() => {
    const m = new Map<string, DailySpend>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const d of days) set.add(d.date.slice(0, 7));
    return [...set].sort();
  }, [days]);

  const [month, setMonth] = useState(months[months.length - 1] ?? "");
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (syncMonth && months.includes(syncMonth)) setMonth(syncMonth);
  }, [syncMonth, months]);

  // Average spend per weekday across the whole data range. No-spend days
  // count as zeros: each weekday's sum is divided by how many times that
  // weekday occurs between the first and last data date, not by spend days.
  const weekdayAvg = useMemo(() => {
    if (!days.length) return null;
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    const last = parseDate(days[days.length - 1].date);
    for (const d = parseDate(days[0].date); d <= last; d.setDate(d.getDate() + 1)) {
      counts[d.getDay()]++;
    }
    for (const d of days) sums[parseDate(d.date).getDay()] += d.total;
    return sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
  }, [days]);

  // Global scale so a quiet month isn't artificially "hot".
  const p95 = useMemo(() => {
    if (!days.length) return 1;
    const totals = days.map((d) => d.total).sort((a, b) => a - b);
    return totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))] || 1;
  }, [days]);

  if (!months.length || !month) return null;

  const idx = months.indexOf(month);
  const [year, monthNum] = [parseInt(month.slice(0, 4)), parseInt(month.slice(5, 7))];
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const firstWeekday = new Date(year, monthNum - 1, 1).getDay();

  const monthDays: (DailySpend | null)[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    monthDays.push(byDate.get(key) ?? null);
  }

  const monthTotal = monthDays.reduce((s, d) => s + (d?.total ?? 0), 0);
  const spendDays = monthDays.filter((d) => d && d.total > 0).length;
  const busiest = monthDays.reduce<DailySpend | null>(
    (best, d) => (d && d.total > (best?.total ?? 0) ? d : best),
    null
  );

  const hoveredDay = hovered ? byDate.get(hovered) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
      {/* Calendar — 2 cols */}
      <div className="col-span-1 md:col-span-2 bg-card p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
            DAILY SPEND — {formatMonthFull(month).toUpperCase()}
          </h2>
          <div className="flex border border-border">
            <button
              onClick={() => idx > 0 && setMonth(months[idx - 1])}
              disabled={idx === 0}
              aria-label="Previous month"
              className="font-mono text-xs px-2.5 py-0.5 transition-colors disabled:opacity-30 enabled:hover:bg-accent"
            >
              ←
            </button>
            <button
              onClick={() => idx < months.length - 1 && setMonth(months[idx + 1])}
              disabled={idx === months.length - 1}
              aria-label="Next month"
              className="font-mono text-xs px-2.5 py-0.5 border-l border-border transition-colors disabled:opacity-30 enabled:hover:bg-accent"
            >
              →
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-[1px] bg-border border border-border">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="bg-card py-1 text-center font-mono text-[9px] tracking-widest text-muted-foreground"
            >
              {w}
            </div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => (
            <div key={`pad-${i}`} className="bg-card aspect-square" />
          ))}
          {monthDays.map((d, i) => {
            const key = `${month}-${String(i + 1).padStart(2, "0")}`;
            const alpha = d
              ? Math.min(1, Math.max(0.12, d.total / p95))
              : 0;
            return (
              <div
                key={key}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                onClick={() => setHovered((h) => (h === key ? null : key))}
                className={`relative aspect-square bg-card ${
                  hovered === key ? "outline outline-1 outline-foreground z-10" : ""
                }`}
              >
                <div
                  className="absolute inset-0"
                  style={d ? { backgroundColor: heatColor(alpha) } : undefined}
                />
                <span className="absolute top-0.5 left-1 font-mono text-[9px] text-muted-foreground">
                  {i + 1}
                </span>
              </div>
            );
          })}
          {/* pad the final row so the bordered grid stays rectangular */}
          {Array.from(
            { length: (7 - ((firstWeekday + daysInMonth) % 7)) % 7 },
            (_, i) => (
              <div key={`tail-${i}`} className="bg-card aspect-square" />
            )
          )}
        </div>

        <div className="flex items-center justify-between mt-3">
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase min-h-4">
            {hoveredDay
              ? `${hovered} · ${formatCurrency(hoveredDay.total)} · ${hoveredDay.count} TXN${hoveredDay.count !== 1 ? "S" : ""}`
              : hovered
              ? `${hovered} · NO SPEND`
              : "TAP OR HOVER A DAY FOR DETAIL"}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] tracking-widest text-muted-foreground">
              LESS
            </span>
            {LEGEND_STOPS.map((a) => (
              <span
                key={a}
                className="w-3 h-3 border border-border"
                style={{ backgroundColor: heatColor(a) }}
              />
            ))}
            <span className="font-mono text-[9px] tracking-widest text-muted-foreground">
              MORE
            </span>
          </div>
        </div>
      </div>

      {/* Month stats */}
      <div className="bg-card p-4 md:p-6 flex flex-col justify-between gap-4">
        <div>
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            MONTH SPEND
          </h2>
          <p className="font-mono text-3xl font-bold">{formatCurrency(monthTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatCurrency(monthTotal / daysInMonth)}/day average
          </p>
        </div>
        <div className="pt-4 border-t border-border">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            BUSIEST DAY
          </h2>
          {busiest ? (
            <>
              <p className="font-mono text-3xl font-bold">
                {formatCurrency(busiest.total)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {busiest.date} · {busiest.count} transaction{busiest.count !== 1 ? "s" : ""}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No spend this month.</p>
          )}
        </div>
        <div className="pt-4 border-t border-border">
          <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            SPEND DAYS
          </h2>
          <p className="font-mono text-3xl font-bold">
            {spendDays}
            <span className="text-muted-foreground font-normal text-lg">
              {" "}/ {daysInMonth}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {daysInMonth - spendDays} no-spend days
          </p>
        </div>
      </div>

      {/* Spend by weekday — full width, whole data range (not just the visible month) */}
      {weekdayAvg && (
        <div className="col-span-1 md:col-span-3 bg-card p-4 md:p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground">
              SPEND BY WEEKDAY
            </h2>
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
              AVG / DAY · ALL {months.length} MONTHS
            </span>
          </div>
          <div className="grid grid-cols-7 gap-[1px] bg-border border border-border">
            {WEEKDAY_NAMES.map((name, i) => {
              const max = Math.max(...weekdayAvg) || 1;
              const avg = weekdayAvg[i];
              const isPeak = avg === max && avg > 0;
              return (
                <div key={name} className="bg-card p-1.5 md:p-3 flex flex-col items-center gap-2">
                  <span className="font-mono text-[10px] tabular-nums">
                    {formatCurrency(avg)}
                  </span>
                  <div className="w-full h-20 flex items-end">
                    <div
                      className="w-full"
                      style={{
                        height: `${(avg / max) * 100}%`,
                        minHeight: avg > 0 ? 2 : 0,
                        backgroundColor: heatColor(
                          Math.min(1, Math.max(0.12, avg / max))
                        ),
                      }}
                    />
                  </div>
                  <span
                    className={`font-mono text-[9px] tracking-widest ${
                      isPeak ? "" : "text-muted-foreground"
                    }`}
                  >
                    {name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
