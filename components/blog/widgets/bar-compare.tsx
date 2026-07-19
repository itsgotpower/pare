"use client";

import { useEffect, useState } from "react";
import { PALETTE } from "@/lib/colors";

// Labeled horizontal bars for a head-to-head comparison (annual cost, storage,
// whatever) — the workhorse for comparison posts. Handmade CSS bars (no charting
// lib) so it adds ~nothing to the bundle. Hovering a row surfaces its exact value.
//
// Props (fed from a :::pare-widget block in the .md — synthetic data only):
//   title:   heading above the bars
//   unit:    prefix ($) or suffix (GB) for the value label; see `unitPosition`
//   series:  2–5 rows, each { label, value, color? }; color falls back to the palette
//   caption: optional muted line under the bars (e.g. a source note)

export interface BarCompareRow {
  label: string;
  value: number;
  color?: string;
}

export interface BarCompareProps {
  title?: string;
  unit?: string;
  unitPosition?: "prefix" | "suffix";
  series: BarCompareRow[];
  caption?: string;
}

const FALLBACK = [
  PALETTE.slate,
  PALETTE.terracotta,
  PALETTE.sage,
  PALETTE.mustard,
  PALETTE.dustyblue,
];

const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(1));

export function BarCompare({
  title,
  unit = "",
  unitPosition = "prefix",
  series = [],
  caption,
}: BarCompareProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  // Bars grow from 0 on first paint (skipped under reduced-motion).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setGrown(true);
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...series.map((s) => s.value));
  const label = (v: number) =>
    unitPosition === "prefix" ? `${unit}${fmt(v)}` : `${fmt(v)}${unit}`;

  return (
    <figure className="border border-border bg-card p-4 md:p-5 my-0">
      {title && (
        <figcaption className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          {title}
        </figcaption>
      )}
      <div className="space-y-3">
        {series.map((row, i) => {
          const color = row.color ?? FALLBACK[i % FALLBACK.length];
          const active = hovered === null || hovered === i;
          return (
            <div
              key={`${row.label}-${i}`}
              className="cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-baseline justify-between mb-1 text-xs">
                <span className="font-mono truncate pr-2">{row.label}</span>
                <span className="font-mono tabular-nums shrink-0">{label(row.value)}</span>
              </div>
              <div className="h-3 bg-accent/60">
                <div
                  className="h-full transition-[width,opacity] duration-500 ease-out"
                  style={{
                    width: grown ? `${(row.value / max) * 100}%` : "0%",
                    backgroundColor: color,
                    opacity: active ? 1 : 0.35,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {caption && (
        <p className="text-[11px] leading-snug text-muted-foreground mt-4">{caption}</p>
      )}
    </figure>
  );
}
