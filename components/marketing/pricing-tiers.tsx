"use client";

import { useState } from "react";
import Link from "next/link";
import { PALETTE } from "@/lib/colors";

// Hosted tier cards + the USD/CAD display toggle for /pricing. Client component
// only because of the toggle — everything else on the page stays server-rendered.
// BILLING IS IN USD (Scott, 2026-07-04); CAD figures are rounded reference
// prices at ~1.37, not a second price list. Free-tier caps here must match the
// enforced caps in cloud/plans.ts (statementsPerMonth) — update both together.

type Currency = "USD" | "CAD";

const TIERS = [
  {
    color: PALETTE.celadon,
    name: "Free",
    price: { USD: "$0", CAD: "C$0" },
    cadence: {
      USD: "forever",
      CAD: "forever",
    },
    blurb:
      "The full product, capped. Enough to move your history in, keep one card current every month, and decide with your own data.",
    limits: ["1 account", "5 statement uploads / month", "Every insight, no trial clock"],
    flag: null,
  },
  {
    color: PALETTE.dustyblue,
    name: "Plus",
    price: { USD: "$8", CAD: "≈C$11" },
    cadence: {
      USD: "per month — or $72/year (2 months free)",
      CAD: "per month — or ≈C$99/year (2 months free)",
    },
    blurb:
      "Room for the full picture — card plus chequing, unlimited statements, and hands-off daily sync via SimpleFIN if you want it.",
    limits: [
      "2 accounts",
      "Unlimited statement uploads",
      "Automatic bank sync (SimpleFIN)",
      "Everything in Free",
    ],
    flag: null,
  },
  {
    color: PALETTE.mustard,
    name: "Founder",
    price: { USD: "$160", CAD: "≈C$219" },
    cadence: {
      USD: "one time",
      CAD: "one time",
    },
    blurb:
      "Pay once, hosted for good. Everything in Plus, for the life of the product — a launch-window offer; when the window closes, it's gone.",
    limits: ["2 accounts, unlimited uploads", "Everything in Plus, permanently", "No renewal, ever"],
    flag: "Launch offer",
  },
] as const;

export function PricingTiers() {
  const [currency, setCurrency] = useState<Currency>("USD");

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex border border-border" role="group" aria-label="Display currency">
          {(["USD", "CAD"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => setCurrency(c)}
              className={`font-mono text-[10px] tracking-widest uppercase px-3 h-8 transition-colors ${
                currency === c
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground text-right">
          {currency === "CAD" ? "Approximate — billed in USD" : "Billed in USD"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
        {TIERS.map((t) => (
          <div key={t.name} className="bg-card p-5 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase">
                  {t.name}
                </h3>
              </div>
              {t.flag ? (
                <span
                  className="font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 text-background"
                  style={{ backgroundColor: PALETTE.mustard }}
                >
                  {t.flag}
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <span className="font-mono text-3xl font-bold tracking-tight">
                {t.price[currency]}
              </span>
              <span className="block font-mono text-[10px] tracking-widest uppercase text-muted-foreground mt-1">
                {t.cadence[currency]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mt-3">{t.blurb}</p>
            <ul className="mt-4 space-y-1.5 flex-1">
              {t.limits.map((l) => (
                <li key={l} className="text-xs text-foreground/90 leading-relaxed flex gap-2">
                  <span className="text-muted-foreground">—</span>
                  {l}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center justify-center border border-border font-mono text-[11px] tracking-widest uppercase h-10 hover:bg-foreground hover:text-background transition-colors"
            >
              Create an account
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
