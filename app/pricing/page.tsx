import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { PricingTiers } from "@/components/marketing/pricing-tiers";

// Public pricing page (middleware PUBLIC_PATHS — crawlable signed-out).
// Structure decided 2026-07-04 (Scott): self-host free forever; hosted FREE
// tier capped (1 account, 5 statement uploads/month — the upload cap is
// enforced by cloud/plans.ts, keep them in sync); PLUS $8/mo or $72/yr
// (2 accounts, unlimited uploads — Founder matches Plus's caps); FOUNDER
// $160 one-time as a LAUNCH-WINDOW offer, not a permanent tier. Billing is in
// USD; the tier grid (components/marketing/pricing-tiers.tsx) has a USD/CAD
// display toggle. Every tier has every feature — you pay for capacity, never
// for your own data (PRD non-goal N2). Hosted signup is open (2026-07-05), so
// all hosted CTAs deep-link to /login?signup=1.

export const metadata: Metadata = {
  title: "Pricing — Pare",
  description:
    "Self-host Pare free forever, or let us host it: free tier, $8/month, $72/year, or a one-time founder purchase. Every plan has every feature — your data is never the price.",
  keywords: [
    "Pare pricing",
    "personal finance app pricing",
    "self-hosted personal finance",
    "Monarch alternative price",
    "YNAB alternative price",
  ],
};

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

const QUESTIONS = [
  {
    q: "Why is self-hosting free?",
    a: "Because the code being open is the point. Pare's promise — it can't shut down on you, it can't sell you — only holds if you can run it yourself. Hosting is the convenience we charge for; the software is yours either way.",
  },
  {
    q: "What does a paid plan actually buy?",
    a: "Capacity, not features. Every tier — including Free and self-host — has the full product: parsing, categories, subscriptions, forecasts, the MCP server. Paid lifts the account and upload caps and covers the isolated per-account infrastructure your data lives in.",
  },
  {
    q: "What happens if I cancel?",
    a: "You keep your data — export everything to CSV, JSON, or a full database backup at any time, no export tax. And because the app is open source, the exit ramp is real: take your backup and self-host, and nothing about the product changes.",
  },
  {
    q: "Is the Founder plan really forever?",
    a: "For the life of the hosted product, yes — everything in Plus, no renewal. Fair-use applies (it covers a person's finances, not a business's books). If hosted Pare ever winds down, you get your full export and the self-hosted app keeps working.",
  },
  {
    q: "Will you make money from my data instead?",
    a: "No. Never data sale, never ad targeting, never monetizing what your statements say — that's a design constraint, not a pricing lever. If Pare doesn't earn its keep from plans like these, it doesn't earn it at all.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      <MarketingHeader />

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>Pricing</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Pay for hosting. Never with your data.
        </h1>
        <p className="text-sm leading-relaxed text-foreground/90 mt-6 max-w-2xl">
          Every plan is the whole product — parsing, categories, subscriptions,
          forecasts, the Claude MCP server. The only question is who runs it: you,
          on your own machine, free forever; or us, with your account in its own
          isolated database. Signing up is free — paid plans only lift the
          capacity caps.
        </p>

        {/* Self-host — the anchor tier, full width */}
        <div className="mt-8 border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 shrink-0"
                style={{ backgroundColor: PALETTE.sage }}
              />
              <h2 className="font-mono text-sm font-bold tracking-widest uppercase">
                Self-host — free forever
              </h2>
            </div>
            <span className="font-mono text-2xl font-bold tracking-tight">$0</span>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed mt-2 max-w-2xl">
            The entire app, open source. Runs on your machine, your data never
            leaves it, and no company decision can take it away from you. This
            isn&apos;t a demo of the paid version — it <em>is</em> the version.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <a
              href="https://github.com/itsgotpower/pare"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center bg-foreground text-background font-mono text-xs tracking-widest uppercase px-5 h-11 hover:opacity-90 transition-opacity"
            >
              Get the code
            </a>
            <Link
              href="/how-it-works"
              className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works →
            </Link>
          </div>
        </div>

        {/* Hosted tiers */}
        <section className="mt-10">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-1">
            Or let us host it
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed mb-4 max-w-2xl">
            Same product, zero setup — each account gets its own isolated
            database, and uploaded PDFs are deleted the moment they&apos;re parsed.
          </p>
          <PricingTiers />
        </section>

        {/* The honest math */}
        <section className="border-t border-border mt-10 pt-6">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">
            The honest math
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-foreground/90">
            <li>
              <span className="font-medium">Monarch:</span>{" "}
              $14.99/month. Pare Plus is $8 — and there&apos;s no aggregator
              between you and your bank.
            </li>
            <li>
              <span className="font-medium">YNAB:</span> $109/year. Pare Plus is
              $72/year — a different paradigm, and a smaller bill.
            </li>
            <li>
              <span className="font-medium">Founder:</span> $160 once is about two
              years of Plus. Everything after that is on us.
            </li>
            <li>
              <span className="font-medium">Self-host:</span> $0, and it stays $0. The
              paid plans exist so that stays true.
            </li>
          </ul>
        </section>

        {/* Fair questions */}
        <section className="border-t border-border mt-10 pt-8">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-4">
            Fair questions
          </h2>
          <div className="space-y-[1px] bg-border border border-border">
            {QUESTIONS.map((f) => (
              <div key={f.q} className="bg-card p-5">
                <h3 className="font-mono text-xs tracking-widest uppercase">{f.q}</h3>
                <p className="text-sm text-foreground/90 leading-relaxed mt-2">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="border-t border-border mt-10 pt-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <Link
            href="/login?signup=1"
            className="inline-flex items-center justify-center bg-foreground text-background font-mono text-xs tracking-widest uppercase px-5 h-11 hover:opacity-90 transition-opacity"
          >
            Sign up
          </Link>
          <Link
            href="/demo"
            className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            See it with sample data →
          </Link>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-8">
          Prices in USD, shown before applicable taxes; CAD figures are
          approximate and for reference only. Signing up on the free tier costs
          nothing and commits you to nothing.
          See the{" "}
          <Link href="/privacy" className="link">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="link">
            Terms
          </Link>
          .
        </p>
      </main>

      <MarketingFooter current="/pricing" />
    </div>
  );
}
