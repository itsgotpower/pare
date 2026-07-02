import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";

// Public "how the parsing works" page — the trust-and-clarity asset from the
// offer-engineering doc (§4.3). Reachable signed-out (added to middleware
// PUBLIC_PATHS + WAITLIST_PUBLIC; the Sidebar hides itself here, same pattern as
// /security and /privacy). Demystifies the parse pipeline so it reads as
// engineering, not a magic trick. Every claim maps to real code — the container
// parser (lib/parser/parser-container-do.ts), the balance-reconciling ledger
// engine, and the delete-after-parse retention (lib/queue/consumer.ts).

export const metadata: Metadata = {
  title: "How it works — PARE",
  description:
    "Drop a bank or credit-card PDF, Pare parses it in seconds — balance-reconciled, then the PDF is deleted — and your dashboard is built. No bank login, no aggregator.",
};

const REPO_URL = "https://github.com/itsgotpower/pare";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

const STEPS = [
  {
    n: "01",
    color: PALETTE.celadon,
    title: "Drop a PDF",
    body: "Export a statement from your bank and drag it in. No login, no aggregator, no MFA. Tuned today for Amex Gold, CIBC Aeroplan Visa, and CIBC chequing — more banks ship as their parsers are verified.",
  },
  {
    n: "02",
    color: PALETTE.dustyblue,
    title: "We parse it in seconds",
    body: "A Python parser runs in a Cloudflare Container: it extracts the text, reads every transaction, and reconciles the running balance against the statement's own summary so totals can't silently drift. Rules categorize each row, and your corrections teach the rules. The PDF is deleted the moment parsing finishes.",
  },
  {
    n: "03",
    color: PALETTE.wheat,
    title: "See where your money went",
    body: "Your dashboard is built on import: spend by category, this month versus last, detected subscriptions, and your savings rate. No pivot tables, no manual tagging.",
  },
];

// The runtime architecture, one line each. Ordered along the request path:
// edge → data → storage → parse.
const STACK = [
  { part: "Next.js 16 on Cloudflare Workers", role: "The app itself — pages and API run at the edge." },
  { part: "Per-user Durable Object (SQLite)", role: "One private database per account. No shared table, no cross-account query." },
  { part: "R2 object storage", role: "Holds an uploaded PDF only until it's parsed, then drops it." },
  { part: "Queues", role: "Hand the parse job off so the upload returns immediately and retries survive a blip." },
  { part: "Python parser in a Container", role: "The same parser you can run locally, isolated per job and asleep when idle." },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Top bar — this page has no app sidebar. */}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-14 border-b border-border">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          PARE
        </Link>
        <Link
          href="/"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </Link>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>How it works</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Drop a PDF. See where your money went.
        </h1>
        <p className="text-sm leading-relaxed text-foreground/90 mt-6 max-w-2xl">
          No &ldquo;connect your bank&rdquo; step, no aggregator sitting between you
          and your accounts. You hand Pare a statement you already have, and it does
          the reading, the math, and the categorizing. Here&apos;s the whole
          pipeline, start to finish.
        </p>

        {/* Three-step flow */}
        <div className="mt-8 space-y-[1px] bg-border border border-border">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-card p-5 flex gap-4">
              <span className="font-mono text-lg font-bold text-muted-foreground tabular-nums">
                {s.n}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <h3 className="font-mono text-xs tracking-widest uppercase">{s.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-8">
          <Section title="Balance-reconciled, not best-effort">
            <p>
              Parsing a statement is easy to get quietly wrong — a missed row, a
              transposed date, a credit read as a charge. Pare&apos;s ledger engine
              ties the running balance it computes back to the balance the statement
              prints. When a row doesn&apos;t reconcile, it&apos;s skipped and logged
              rather than folded into a wrong total. You get missing rows you can
              see, never corrupted numbers you can&apos;t.
            </p>
          </Section>

          <Section title="Categorization that learns">
            <p>
              Categories are assigned on parse by a first-match-wins rule list, so a
              300-line statement is sorted the second it lands — you don&apos;t touch
              300 dropdowns. When you re-file a merchant, that correction becomes a
              rule and re-applies to everything, including past transactions. The
              taxonomy is generic in the open-source code; your tuned rules live only
              in your database.
            </p>
          </Section>

          <Section title="Under the hood">
            <p>
              For the curious: the whole thing runs on Cloudflare. Nothing here is
              proprietary black-box magic — it&apos;s the parser you can{" "}
              <a href={REPO_URL} className="underline" target="_blank" rel="noreferrer">
                read on GitHub
              </a>{" "}
              and run on your own machine.
            </p>
            <div className="space-y-[1px] bg-border border border-border mt-2">
              {STACK.map((s) => (
                <div key={s.part} className="bg-card p-3.5">
                  <h3 className="font-mono text-[11px] tracking-widest uppercase">{s.part}</h3>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    {s.role}
                  </p>
                </div>
              ))}
            </div>
            <p>
              Same code, two shapes: the hosted app splits the parser into a Container
              and the database into a per-user Durable Object; self-host collapses
              both into one local process over a SQLite file. The parsing logic is
              identical either way.
            </p>
          </Section>
        </div>

        {/* CTA */}
        <div className="border-t border-border mt-10 pt-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center bg-foreground text-background font-mono text-xs tracking-widest uppercase px-5 h-11 hover:opacity-90 transition-opacity"
          >
            Join the waitlist
          </Link>
          <Link
            href="/privacy"
            className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            What happens to your data →
          </Link>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
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
        </div>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          pare
        </Link>
      </footer>
    </div>
  );
}
