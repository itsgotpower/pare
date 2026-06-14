"use client";

import { useEffect, useState } from "react";

// A small monochrome analog clock + local date/time for the marketing header.
// Renders a fixed-size placeholder until mounted so the server render and the
// first client paint agree — the dial needs the visitor's local time, which the
// server can't know, so drawing it on the server would cause a hydration
// mismatch. Ticks once a second; honours prefers-reduced-motion by dropping the
// sweeping second hand (the dial then updates each minute via the same interval).
export function LocalClock({ className }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Reserve the cluster's footprint before mount to avoid layout shift.
  if (!now) return <div className={className} style={{ width: 112, height: 24 }} aria-hidden="true" />;

  const s = now.getSeconds();
  const m = now.getMinutes();
  const h = now.getHours();
  const hourDeg = (h % 12) * 30 + m * 0.5;
  const minDeg = m * 6 + s * 0.1;
  const secDeg = s * 6;

  const wd = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const mo = now.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const date = `${wd} ${now.getDate()} ${mo}`;
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <svg
        viewBox="0 0 100 100"
        className="size-6 text-foreground"
        role="img"
        aria-label={`Local time ${time}`}
      >
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" />
        {/* Hour ticks — quarters heavier, like a printed dial */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1="50"
            y1="6"
            x2="50"
            y2={i % 3 === 0 ? 13 : 10}
            stroke="currentColor"
            strokeWidth={i % 3 === 0 ? 2 : 1}
            opacity={i % 3 === 0 ? 0.9 : 0.4}
            transform={`rotate(${i * 30} 50 50)`}
          />
        ))}
        {/* Hour hand */}
        <line
          x1="50"
          y1="52"
          x2="50"
          y2="30"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="square"
          transform={`rotate(${hourDeg} 50 50)`}
        />
        {/* Minute hand */}
        <line
          x1="50"
          y1="54"
          x2="50"
          y2="19"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
          transform={`rotate(${minDeg} 50 50)`}
        />
        {/* Second hand */}
        {!reduced && (
          <line
            x1="50"
            y1="58"
            x2="50"
            y2="15"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.55"
            transform={`rotate(${secDeg} 50 50)`}
          />
        )}
        <circle cx="50" cy="50" r="2.5" fill="currentColor" />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="font-mono text-[10px] tracking-widest uppercase">{date}</span>
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground tabular-nums">
          {time}
        </span>
      </div>
    </div>
  );
}
