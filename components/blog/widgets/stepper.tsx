"use client";

import { useState } from "react";

// Interactive numbered steps for a how-to / routine post — turns a wall of "first
// do this, then that" prose into something the reader clicks through. One step
// visible at a time, with prev/next, a clickable number rail, and ←/→ keys.
//
// Props (plain text only — body is rendered as text, not HTML/markdown):
//   title: optional heading above the rail
//   steps: ordered { title, body }; 2–8 works best

export interface Step {
  title: string;
  body: string;
}

export interface StepperProps {
  title?: string;
  steps: Step[];
}

export function Stepper({ title, steps = [] }: StepperProps) {
  const [i, setI] = useState(0);
  if (steps.length === 0) return null;

  const clamp = (n: number) => Math.max(0, Math.min(steps.length - 1, n));
  const go = (n: number) => setI(clamp(n));
  const active = steps[i];

  return (
    <figure
      className="border border-border bg-card p-4 md:p-5 my-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      tabIndex={0}
      role="group"
      aria-label={title ? `${title} — step ${i + 1} of ${steps.length}` : `Step ${i + 1} of ${steps.length}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(i + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(i - 1);
        }
      }}
    >
      {title && (
        <figcaption className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
          {title}
        </figcaption>
      )}

      {/* Number rail — click to jump. */}
      <div className="flex items-center gap-1.5 mb-4" role="tablist" aria-label="Steps">
        {steps.map((s, n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === i}
            aria-label={`Step ${n + 1}: ${s.title}`}
            onClick={() => go(n)}
            className={`font-mono text-xs tabular-nums w-7 h-7 border transition-colors ${
              n === i
                ? "border-foreground bg-foreground text-background"
                : n < i
                  ? "border-border text-foreground hover:bg-muted"
                  : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {n + 1}
          </button>
        ))}
      </div>

      <div className="min-h-[4.5rem]">
        <p className="font-mono text-sm font-bold tracking-tight">{active.title}</p>
        <p className="text-sm leading-relaxed text-foreground/90 mt-1.5">{active.body}</p>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="font-mono text-[11px] tracking-widest uppercase px-3 h-8 border border-border text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          ← Prev
        </button>
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground tabular-nums">
          {i + 1} / {steps.length}
        </span>
        <button
          type="button"
          onClick={() => go(i + 1)}
          disabled={i === steps.length - 1}
          className="font-mono text-[11px] tracking-widest uppercase px-3 h-8 border border-border text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          Next →
        </button>
      </div>
    </figure>
  );
}
