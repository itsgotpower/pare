"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { PALETTE } from "@/lib/colors";
import { Turnstile } from "@/components/turnstile";
import { LocalClock } from "@/components/local-clock";

const REPO_URL = "https://github.com/itsgotpower/pare";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

// WAITLIST LAUNCH: when set at build time, hide every "Sign in" affordance so the
// landing is a pure waitlist page (the Edge middleware also redirects /login and
// the app routes to "/"). Unset it + rebuild to restore the full app.
const WAITLIST_ONLY = process.env.NEXT_PUBLIC_WAITLIST_ONLY === "1";

// lucide-react dropped its brand icons, so inline the GitHub mark.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.33-1.73-1.33-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.23-3.15-.12-.3-.53-1.51.12-3.15 0 0 1-.31 3.3 1.2.96-.26 1.98-.39 3-.4 1.02 0 2.04.14 3 .4 2.28-1.52 3.29-1.2 3.29-1.2.65 1.64.24 2.85.12 3.15.77.82 1.23 1.87 1.23 3.15 0 4.51-2.81 5.5-5.49 5.79.43.36.81 1.08.81 2.18 0 1.58-.01 2.85-.01 3.24 0 .31.21.68.83.56C20.57 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

// Illustrative figures for the interactive product-preview bento. This page is
// public (signed out), so it can't read real data — hovering/selecting a bar
// just scrubs through these synthetic months. The last entry is "this month"
// and matches the value the hero counts up to. Each month's `cats` are
// pre-sorted high→low so the TOP CATEGORIES list re-ranks as you scrub.
const PREVIEW_MONTHS = [
  { caption: "NOV 2025", height: 62, total: 1529, recurring: 286, subs: 7,
    cats: [{ name: "GROCERIES", pct: 84, color: PALETTE.celadon }, { name: "SHOPPING", pct: 41, color: PALETTE.wheat }, { name: "DINING", pct: 27, color: PALETTE.terracotta }] },
  { caption: "DEC 2025", height: 88, total: 2170, recurring: 305, subs: 8,
    cats: [{ name: "SHOPPING", pct: 92, color: PALETTE.wheat }, { name: "GROCERIES", pct: 68, color: PALETTE.celadon }, { name: "DINING", pct: 54, color: PALETTE.terracotta }] },
  { caption: "JAN 2026", height: 54, total: 1332, recurring: 312, subs: 9,
    cats: [{ name: "GROCERIES", pct: 88, color: PALETTE.celadon }, { name: "TRANSPORT", pct: 44, color: PALETTE.mustard }, { name: "DINING", pct: 22, color: PALETTE.terracotta }] },
  { caption: "FEB 2026", height: 95, total: 2343, recurring: 298, subs: 8,
    cats: [{ name: "GROCERIES", pct: 80, color: PALETTE.celadon }, { name: "DINING", pct: 52, color: PALETTE.terracotta }, { name: "TRAVEL", pct: 34, color: PALETTE.dustyblue }] },
  { caption: "MAR 2026", height: 70, total: 1726, recurring: 290, subs: 8,
    cats: [{ name: "TRAVEL", pct: 95, color: PALETTE.dustyblue }, { name: "GROCERIES", pct: 58, color: PALETTE.celadon }, { name: "DINING", pct: 36, color: PALETTE.terracotta }] },
  { caption: "APR 2026", height: 78, total: 1924, recurring: 301, subs: 9,
    cats: [{ name: "GROCERIES", pct: 86, color: PALETTE.celadon }, { name: "SHOPPING", pct: 47, color: PALETTE.wheat }, { name: "DINING", pct: 31, color: PALETTE.terracotta }] },
  { caption: "MAY 2026", height: 60, total: 1480, recurring: 296, subs: 8,
    cats: [{ name: "GROCERIES", pct: 76, color: PALETTE.celadon }, { name: "DINING", pct: 58, color: PALETTE.terracotta }, { name: "TRANSPORT", pct: 33, color: PALETTE.mustard }] },
  { caption: "THIS MONTH", height: 100, total: 2466, recurring: 298, subs: 8,
    cats: [{ name: "GROCERIES", pct: 100, color: PALETTE.celadon }, { name: "SHOPPING", pct: 32, color: PALETTE.wheat }, { name: "DINING", pct: 19, color: PALETTE.terracotta }] },
];
const LATEST_MONTH = PREVIEW_MONTHS.length - 1;

// "What you don't have to do anymore" — the pain-led module from the offer-
// engineering doc (§4.1). Each card names a thing users of Mint/Monarch/etc.
// hate, states Pare's removal, and backs it with the architectural proof. Copy is
// fixed by the brief; keep the brutalist voice (no "seamless"/"intuitive"/etc.).
const PAINS = [
  {
    color: PALETTE.celadon,
    title: "No bank login",
    sub: "Drop in a PDF. No aggregators, no MFA hell, no “your bank doesn’t sync anymore” emails.",
    proof: "Statements you already have — we never touch your bank.",
  },
  {
    color: PALETTE.dustyblue,
    title: "No category tagging",
    sub: "Auto-categorization on parse. Corrections learn.",
    proof: "We process 300 transactions in seconds so you don’t have to touch 300 dropdowns.",
  },
  {
    color: PALETTE.wheat,
    title: "No data sold",
    sub: "Per-user database, ephemeral PDF parsing, open source.",
    proof: "The proof is in the code, not the marketing.",
    proofHref: "/privacy",
  },
];

const FEATURES = [
  { label: "Runs on your machine", color: PALETTE.slate },
  { label: "Statements shredded on import", color: PALETTE.celadon },
  { label: "Free, no card needed", color: PALETTE.terracotta },
  { label: "Monarch import coming", color: PALETTE.dustyblue },
  { label: "Open source on GitHub", color: PALETTE.sage },
  { label: "Forecasts & budgets built in", color: PALETTE.mustard },
  { label: "No ads, no tracking", color: PALETTE.wheat },
  { label: "Claude MCP support", color: PALETTE.slate },
  { label: "iOS app coming soon", color: PALETTE.celadon },
];

type Status = "idle" | "loading" | "done" | "error";

// Count up to `target` once on mount (easeOutCubic), to sync with the bento's
// bar reveal. Deps are stable, so it does NOT replay when the page re-renders on
// every waitlist-input keystroke. Honours prefers-reduced-motion (jumps to the
// final value). SSR renders 0 and the client's first paint also renders 0, so
// there's no hydration mismatch — the rAF effect animates after hydration.
function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export default function MarketingHome() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  // Turnstile token (empty until solved). The widget renders only when a public
  // site key is configured; with no key the server skips verification, so an
  // empty token is fine in dev/self-host.
  const [turnstileToken, setTurnstileToken] = useState("");
  const [dark, setDark] = useState(false);
  // Which preview month the bento is showing. Defaults to the latest; hovering /
  // focusing / tapping a bar scrubs, and leaving the chart snaps back to latest.
  const [selectedMonth, setSelectedMonth] = useState(LATEST_MONTH);
  const thisMonth = useCountUp(PREVIEW_MONTHS[LATEST_MONTH].total);

  const month = PREVIEW_MONTHS[selectedMonth];
  // On mount the big number counts up to the latest total; once the user scrubs
  // to another month, show that month's exact figure (the count-up has finished).
  const displayTotal = selectedMonth === LATEST_MONTH ? thisMonth : month.total;

  // Mirror the app's dark-mode mechanism (lib navbar) so the preference is
  // shared: same `parse-dark` key, same `.dark` class on <html>. The Sidebar is
  // hidden on "/", so the marketing page owns the toggle here.
  useEffect(() => {
    if (localStorage.getItem("parse-dark") === "true") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("parse-dark", String(next));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Try again.");
        return;
      }
      setStatus("done");
      setMessage(
        data.alreadyJoined ? "You're already on the list — sit tight." : "You're on the list. We'll be in touch."
      );
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
    }
  };

  return (
    // The landing now SCROLLS: the hero is a full-height first screen (unchanged
    // at-a-glance), and the "what you don't have to do anymore" pain module sits
    // below it (offer-engineering §4.1/§6.1). The zero-scroll invariant applies to
    // the hero screen only, not the whole page.
    <div className="flex flex-col min-h-full">
      {/* Top bar */}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-border">
        <div className="flex items-center gap-4 md:gap-5">
          <span className="font-mono text-sm font-bold tracking-tight">
            <span aria-hidden="true">🍐</span> PARE
          </span>
          <span className="block h-6 w-px bg-border" aria-hidden="true" />
          <LocalClock className="flex" />
        </div>
        <div className="flex items-center gap-5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <GithubMark className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          {!WAITLIST_ONLY && (
            <Link
              href="/login"
              className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
          )}
          <button
            type="button"
            onClick={toggleDark}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </header>

      {/* Hero — full-height first screen (header h-14 = 3.5rem). */}
      <main className="grid grid-cols-1 md:grid-cols-2 min-h-[calc(100svh-3.5rem)]">
        {/* Pitch + CTA */}
        <div className="flex flex-col justify-center px-5 md:px-12 py-6 md:py-0 min-h-0">
          <p className="font-mono text-[10px] md:text-xs tracking-[0.25em] uppercase text-muted-foreground">
            Personal finance, pared down
          </p>
          <h1 className="font-mono font-bold tracking-tight leading-[0.95] mt-3 text-[2rem] sm:text-5xl xl:text-6xl">
            Talk to Claude
            <br />
            about your money.
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-4 max-w-md leading-relaxed">
            Drop in your bank and credit-card statements and Pare reads every
            transaction, categorizes it, and surfaces trends, forecasts, and
            subscription alerts. Then connect Claude over MCP to build a budget
            and save more money.{" "}
            <span className="text-foreground font-medium">
              All files are deleted after parsing; nothing is stored or shared.
            </span>
          </p>

          {/* Waitlist form */}
          <form onSubmit={submit} className="mt-6 max-w-md">
            <div className="flex flex-row gap-[1px] bg-border border border-border">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "done"}
                placeholder="you@email.com"
                aria-label="Email address"
                className="flex-1 min-w-0 bg-card px-4 h-11 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={status === "loading" || status === "done"}
                className="shrink-0 bg-foreground text-background font-mono text-xs tracking-widest uppercase px-4 sm:px-5 h-11 hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
              >
                {status === "loading" ? "…" : status === "done" ? "Joined ✓" : "Join waitlist"}
              </button>
            </div>
            {/* Renders nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so the
                zero-scroll landing stays zero-scroll in dev / self-host. */}
            <Turnstile onToken={setTurnstileToken} className="mt-2" />
            <p
              className={`text-xs mt-2 h-4 ${
                status === "error" ? "text-[color:var(--destructive,#b3654a)]" : "text-muted-foreground"
              }`}
            >
              {message || "Free to start when the hosted version opens."}
            </p>
          </form>

          <div className="mt-3 flex items-center gap-5">
            <Link
              href="/demo"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors w-fit"
            >
              See it with sample data <ArrowRight className="size-3.5" />
            </Link>
            {!WAITLIST_ONLY && (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors w-fit"
              >
                Already have access? Sign in <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Product preview — an interactive echo of the app's bento. Hover, focus
            or tap a bar to scrub through months; the figures react. Hidden on
            phones so the hero stays zero-scroll on small screens. */}
        <div className="hidden md:flex items-center justify-center border-l border-border bg-secondary/40 p-10 min-h-0">
          <div className="w-full max-w-sm grid grid-cols-2 grid-rows-2 gap-[1px] bg-border border border-border shadow-sm">
            {/* THIS MONTH + scrubable bars */}
            <div className="col-span-2 bg-card p-5 flex flex-col">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                {month.caption}
              </span>
              <span className="font-mono text-3xl font-bold tracking-tight mt-1 tabular-nums">
                ${displayTotal.toLocaleString("en-US")}
              </span>
              <div
                className="flex items-end gap-1 h-10 mt-3"
                onMouseLeave={() => setSelectedMonth(LATEST_MONTH)}
              >
                {PREVIEW_MONTHS.map((m, i) => {
                  const active = i === selectedMonth;
                  return (
                    <button
                      key={m.caption}
                      type="button"
                      aria-label={`${m.caption} — $${m.total.toLocaleString("en-US")}`}
                      aria-pressed={active}
                      onMouseEnter={() => setSelectedMonth(i)}
                      onFocus={() => setSelectedMonth(i)}
                      onClick={() => setSelectedMonth(i)}
                      className="flex-1 h-full flex items-end cursor-pointer group focus:outline-none"
                    >
                      <span
                        className="w-full pare-rise transition-[background-color,opacity] duration-150 group-hover:opacity-90 group-focus-visible:ring-1 group-focus-visible:ring-foreground"
                        style={{
                          height: `${m.height}%`,
                          backgroundColor: active ? PALETTE.slate : "var(--muted)",
                          animationDelay: `${i * 55}ms`,
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            {/* RECURRING */}
            <div className="bg-card p-5 flex flex-col justify-center">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                Recurring
              </span>
              <span className="font-mono text-2xl font-bold tracking-tight mt-1 tabular-nums">
                ${month.recurring}
                <span className="text-xs font-normal text-muted-foreground">/mo</span>
              </span>
              <span className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                {month.subs} subscriptions
              </span>
            </div>
            {/* TOP CATEGORIES */}
            <div className="bg-card p-5 flex flex-col justify-center gap-2">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-0.5">
                Top categories
              </span>
              {month.cats.map((c) => (
                <div key={c.name}>
                  <span className="font-mono text-[9px] tracking-wide text-muted-foreground">
                    {c.name}
                  </span>
                  <div className="h-1.5 bg-muted mt-0.5">
                    <div
                      className="h-full transition-[width] duration-300 ease-out"
                      style={{ width: `${c.pct}%`, backgroundColor: c.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* What you don't have to do anymore — pain-led module under the hero. */}
      <section className="border-t border-border px-5 md:px-8 py-10 md:py-14">
        <p className="font-mono text-[10px] md:text-xs tracking-[0.25em] uppercase text-muted-foreground">
          What you don’t have to do anymore
        </p>
        <h2 className="font-mono font-bold tracking-tight leading-[1] mt-2 text-2xl sm:text-3xl">
          Pare wins by removing what you hate.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border mt-6 md:mt-8">
          {PAINS.map((p) => (
            <div key={p.title} className="bg-card p-5 md:p-6 flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase">
                  {p.title}
                </h3>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed mt-3">{p.sub}</p>
              <p className="mt-auto pt-4 text-xs text-muted-foreground leading-relaxed border-t border-border/60">
                {p.proofHref ? (
                  <Link href={p.proofHref} className="underline hover:text-foreground transition-colors">
                    {p.proof}
                  </Link>
                ) : (
                  p.proof
                )}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer — two tiers: the feature claims, then a thin meta/nav bar. The
          split keeps product claims (colour-dotted) from blurring into
          navigation. Stays compact for the zero-scroll landing. */}
      <footer className="shrink-0 border-t border-border">
        {/* Tier 1 — feature claims as an infinite marquee ticker. Two identical
            groups translate -50% for a seamless loop; the claims repeat within a
            group so each group stays ≥ viewport-wide (no gap). The visible track
            is decorative — an sr-only list carries the claims for assistive tech. */}
        <div className="overflow-hidden py-3">
          <ul className="sr-only">
            {FEATURES.map((f) => (
              <li key={f.label}>{f.label}</li>
            ))}
          </ul>
          <div aria-hidden className="pare-marquee flex w-max">
            {[0, 1].map((group) => (
              <div key={group} className="flex shrink-0 items-center">
                {[...FEATURES, ...FEATURES].map((f, i) => (
                  <span
                    key={`${group}-${i}`}
                    className="flex items-center gap-2 font-mono text-[11px] tracking-wide uppercase whitespace-nowrap px-6"
                  >
                    <span
                      className="inline-block w-2 h-2 shrink-0"
                      style={{ backgroundColor: f.color }}
                    />
                    {f.label}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Tier 2 — navigation on top, then brand/meta. Stacked + left-aligned
            so the links sit above the copyright line at every width. */}
        <div className="border-t border-border px-5 md:px-8 py-2.5 flex flex-col items-start gap-y-2">
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              <GithubMark className="size-3.5" />
              GitHub
            </a>
            <Link
              href="/about"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              About
            </Link>
            <Link
              href="/mcp"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              MCP
            </Link>
            <Link
              href="/how-it-works"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works
            </Link>
            <Link
              href="/switch"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Switching
            </Link>
            <Link
              href="/privacy"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/security"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Security
            </Link>
            <Link
              href="/terms"
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </Link>
          </nav>
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span aria-hidden="true">✂️🍐</span>
            <span className="font-mono tracking-wide uppercase text-foreground">Pare</span>
            <span className="hidden sm:inline">— private by design.</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">© {new Date().getFullYear()} pare.money</span>
            {APP_VERSION && (
              <>
                <span aria-hidden="true">·</span>
                <a
                  href={`${REPO_URL}/releases/tag/v${APP_VERSION}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono whitespace-nowrap hover:text-foreground transition-colors"
                >
                  v{APP_VERSION}
                </a>
              </>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}
