"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PALETTE } from "@/lib/colors";

const REPO_URL = "https://github.com/itsgotpower/parse-fi";

// lucide-react dropped its brand icons, so inline the GitHub mark.
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.33-1.73-1.33-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.23-3.15-.12-.3-.53-1.51.12-3.15 0 0 1-.31 3.3 1.2.96-.26 1.98-.39 3-.4 1.02 0 2.04.14 3 .4 2.28-1.52 3.29-1.2 3.29-1.2.65 1.64.24 2.85.12 3.15.77.82 1.23 1.87 1.23 3.15 0 4.51-2.81 5.5-5.49 5.79.43.36.81 1.08.81 2.18 0 1.58-.01 2.85-.01 3.24 0 .31.21.68.83.56C20.57 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

// Static figures for the product-preview bento. This page is public (signed
// out), so it can't read real data — these illustrate the app, nothing more.
const PREVIEW_CATEGORIES = [
  { name: "GROCERIES", pct: 100, color: PALETTE.celadon },
  { name: "SHOPPING", pct: 32, color: PALETTE.wheat },
  { name: "DINING", pct: 19, color: PALETTE.terracotta },
];
const PREVIEW_SPARK = [62, 88, 54, 95, 70, 78, 60, 100];

const FEATURES = [
  { label: "Reads your PDFs", color: PALETTE.slate },
  { label: "Categorizes automatically", color: PALETTE.celadon },
  { label: "Forecasts your cash flow", color: PALETTE.dustyblue },
  { label: "Flags recurring charges", color: PALETTE.terracotta },
];

type Status = "idle" | "loading" | "done" | "error";

export default function MarketingHome() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-14 border-b border-border">
        <span className="font-mono text-sm font-bold tracking-tight">PARE</span>
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
          <Link
            href="/login"
            className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2">
        {/* Pitch + CTA */}
        <div className="flex flex-col justify-center px-5 md:px-12 py-6 md:py-0 min-h-0">
          <p className="font-mono text-[10px] md:text-xs tracking-[0.25em] uppercase text-muted-foreground">
            Personal finance, parsed
          </p>
          <h1 className="font-mono font-bold tracking-tight leading-[0.95] mt-3 text-[2rem] sm:text-5xl xl:text-6xl">
            Your bank
            <br />
            statements,
            <br />
            finally legible.
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-4 max-w-md leading-relaxed">
            Drop in a PDF from your bank or credit card. Pare pulls out every
            transaction, categorizes it, and turns months of statements into
            spending trends, budgets, forecasts, and subscription alerts.
            Free and open source.
          </p>

          {/* Waitlist form */}
          <form onSubmit={submit} className="mt-6 max-w-md">
            <div className="flex flex-col sm:flex-row gap-[1px] bg-border border border-border">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "done"}
                placeholder="you@email.com"
                aria-label="Email address"
                className="flex-1 bg-card px-4 h-11 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={status === "loading" || status === "done"}
                className="bg-foreground text-background font-mono text-xs tracking-widest uppercase px-5 h-11 hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
              >
                {status === "loading" ? "…" : status === "done" ? "Joined ✓" : "Join waitlist"}
              </button>
            </div>
            <p
              className={`text-xs mt-2 h-4 ${
                status === "error" ? "text-[color:var(--destructive,#b3654a)]" : "text-muted-foreground"
              }`}
            >
              {message || "Join the waitlist for the hosted version."}
            </p>
          </form>

          <Link
            href="/login"
            className="mt-3 inline-flex items-center gap-1.5 font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            Already have access? Sign in <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Product preview — a static echo of the app's bento (hidden on phones
            so the hero stays zero-scroll on small screens). */}
        <div className="hidden md:flex items-center justify-center border-l border-border bg-secondary/40 p-10 min-h-0">
          <div className="w-full max-w-sm grid grid-cols-2 grid-rows-2 gap-[1px] bg-border border border-border shadow-sm">
            {/* THIS MONTH */}
            <div className="col-span-2 bg-card p-5 flex flex-col">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                This month
              </span>
              <span className="font-mono text-3xl font-bold tracking-tight mt-1">$2,466</span>
              <div className="flex items-end gap-1 h-10 mt-3">
                {PREVIEW_SPARK.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1"
                    style={{
                      height: `${h}%`,
                      backgroundColor: i === PREVIEW_SPARK.length - 1 ? PALETTE.slate : "var(--muted)",
                    }}
                  />
                ))}
              </div>
            </div>
            {/* RECURRING */}
            <div className="bg-card p-5 flex flex-col justify-center">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
                Recurring
              </span>
              <span className="font-mono text-2xl font-bold tracking-tight mt-1">
                $298<span className="text-xs font-normal text-muted-foreground">/mo</span>
              </span>
              <span className="text-[11px] text-muted-foreground mt-1">8 subscriptions</span>
            </div>
            {/* TOP CATEGORIES */}
            <div className="bg-card p-5 flex flex-col justify-center gap-2">
              <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-0.5">
                Top categories
              </span>
              {PREVIEW_CATEGORIES.map((c) => (
                <div key={c.name}>
                  <span className="font-mono text-[9px] tracking-wide text-muted-foreground">
                    {c.name}
                  </span>
                  <div className="h-1.5 bg-muted mt-0.5">
                    <div className="h-full" style={{ width: `${c.pct}%`, backgroundColor: c.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Feature strip */}
      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        {FEATURES.map((f) => (
          <span key={f.label} className="flex items-center gap-2 font-mono text-[11px] tracking-wide uppercase">
            <span className="inline-block w-2 h-2 shrink-0" style={{ backgroundColor: f.color }} />
            {f.label}
          </span>
        ))}
        <div className="md:ml-auto flex items-center gap-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide uppercase hover:text-foreground transition-colors"
          >
            <GithubMark className="size-3.5" />
            Open source
          </a>
          <span className="text-[11px] text-muted-foreground">Private by design.</span>
        </div>
      </footer>
    </div>
  );
}
