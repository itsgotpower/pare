"use client";

import { useState } from "react";
import { CATEGORY_COLORS, PALETTE } from "@/lib/colors";

// Proportional donut for a breakdown/distribution (where the money goes, how a
// total splits). SVG stroke-dasharray arcs — no charting lib. Hovering a legend
// row or an arc highlights that slice and shows its share in the center.
//
// Props (synthetic data only — the blog is public and can't read real data):
//   title:  heading above the ring
//   unit:   value prefix ($) for legend amounts; omit for unit-less counts
//   slices: 2–8 { label, value }; colors come from categoryColor(label) so app
//           categories map to the same hues as the dashboard, else a palette cycle
//   caption: optional muted source/context line

export interface DonutSlice {
  label: string;
  value: number;
}

export interface DonutProps {
  title?: string;
  unit?: string;
  slices: DonutSlice[];
  caption?: string;
}

// Saturated, mutually-distinct hues for the ring (pale tones like greige/cream
// read as gaps on the card, so they're left out of the cycle).
const FALLBACK = [
  PALETTE.sage,
  PALETTE.terracotta,
  PALETTE.slate,
  PALETTE.mustard,
  PALETTE.dustyblue,
  PALETTE.rose,
  PALETTE.celadon,
  PALETTE.espresso,
];

// Ring geometry. r is the stroke centerline radius; the SVG is 2*(r+stroke/2).
const R = 60;
const STROKE = 22;
const C = 2 * Math.PI * R;
const SIZE = 2 * (R + STROKE / 2);

export function Donut({ title, unit = "", slices = [], caption }: DonutProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  // Match the dashboard hue when a slice names a real app category; otherwise cycle
  // the palette by index so adjacent slices are always distinct (categoryColor()
  // hashes arbitrary labels and can collide two slices onto the same tone).
  const colorFor = (label: string, i: number) =>
    CATEGORY_COLORS[label] ?? FALLBACK[i % FALLBACK.length];
  const fmtValue = (v: number) => `${unit}${v.toLocaleString("en-US")}`;

  // Center readout: hovered slice, else the total.
  const center =
    hovered != null
      ? { top: `${Math.round((slices[hovered].value / total) * 100)}%`, bot: slices[hovered].label }
      : { top: fmtValue(total), bot: "TOTAL" };

  let offset = 0;

  return (
    <figure className="border border-border bg-card p-4 md:p-5 my-0">
      {title && (
        <figcaption className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          {title}
        </figcaption>
      )}
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            style={{ transform: "rotate(-90deg)" }}
            role="img"
            aria-label={title ? `${title} breakdown` : "breakdown"}
          >
            {slices.map((s, i) => {
              const frac = s.value / total;
              const dash = frac * C;
              const el = (
                <circle
                  key={`${s.label}-${i}`}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={colorFor(s.label, i)}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    opacity: hovered === null || hovered === i ? 1 : 0.3,
                    transition: "opacity 200ms ease",
                    cursor: "default",
                  }}
                />
              );
              offset += dash;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-mono text-lg font-bold tabular-nums leading-none">
              {center.top}
            </span>
            <span className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground mt-1 max-w-[6rem] truncate">
              {center.bot}
            </span>
          </div>
        </div>

        <ul className="flex-1 w-full space-y-1">
          {slices.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              className="flex items-center justify-between text-xs py-0.5"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ opacity: hovered === null || hovered === i ? 1 : 0.45, transition: "opacity 200ms ease" }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 inline-block shrink-0"
                  style={{ backgroundColor: colorFor(s.label, i) }}
                />
                <span className="font-mono truncate">{s.label}</span>
              </span>
              <span className="font-mono tabular-nums shrink-0 ml-2">
                {fmtValue(s.value)}
                <span className="text-muted-foreground ml-1.5">
                  {Math.round((s.value / total) * 100)}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {caption && (
        <p className="text-[11px] leading-snug text-muted-foreground mt-4">{caption}</p>
      )}
    </figure>
  );
}
