import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

// Public About page. Reachable signed-out, exactly like /privacy and /terms:
// hosted mode retires the auth gate, and self-host adds "/about" to the gate's
// PUBLIC_PATHS (middleware.ts). The Sidebar hides itself here
// (components/layout/navbar.tsx), so this page renders its own chrome.
//
// Marketing/explainer page — what Pare is, why it exists, and the principles
// (local-first, privacy, open source, brutalist design). No personal data, so
// it can render statically.

export const metadata: Metadata = {
  title: "About — PARE",
  description:
    "What Pare is and why it exists: a local-first personal finance app that turns bank and credit-card PDFs into legible spending insights — private by design and open source.",
};

const REPO_URL = "https://github.com/itsgotpower/pare";

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

// lucide-react dropped its brand icons, so inline the GitHub mark (same as the
// marketing landing).
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.21 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.33-1.73-1.33-1.73-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.81 0-1.28.47-2.33 1.23-3.15-.12-.3-.53-1.51.12-3.15 0 0 1-.31 3.3 1.2.96-.26 1.98-.39 3-.4 1.02 0 2.04.14 3 .4 2.28-1.52 3.29-1.2 3.29-1.2.65 1.64.24 2.85.12 3.15.77.82 1.23 1.87 1.23 3.15 0 4.51-2.81 5.5-5.49 5.79.43.36.81 1.08.81 2.18 0 1.58-.01 2.85-.01 3.24 0 .31.21.68.83.56C20.57 21.91 24 17.5 24 12.29 24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

const PRINCIPLES = [
  {
    color: PALETTE.slate,
    title: "Local-first",
    body: "Your statements are parsed and stored on the machine that runs Pare — into a single SQLite file you control. By default nothing connects to your bank at all; the one exception, SimpleFIN sync, is opt-in, read-only, and a bridge you pay and control — never a login you hand to Pare.",
  },
  {
    color: PALETTE.celadon,
    title: "Private by design",
    body: "Every transaction is treated as PII. Uploaded PDFs are deleted after parsing, real financial data never lands in the source tree, and nothing is sold, shared for ads, or used to train anything.",
  },
  {
    color: PALETTE.terracotta,
    title: "Just your statements",
    body: "Drop in a bank or credit-card PDF and Pare reads every transaction, categorizes it with rules you can tune, and turns months of statements into trends, forecasts, net worth, and subscription alerts.",
  },
  {
    color: PALETTE.dustyblue,
    title: "Open source",
    body: "Pare is AGPL-3.0-licensed and self-hostable. Don't want to trust a hosted service? Run your own copy — the code is all there, and the parser, database, and MCP server work the same locally.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Top bar — this page has no app sidebar. */}
      <MarketingHeader />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>About</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Personal finance, pared down.
        </h1>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare turns your bank and credit-card PDF statements into something
          legible. Instead of connecting your accounts to an aggregator, you give
          Pare the statements you already get every month — it reads every
          transaction, categorizes it, and builds spending trends, cash-flow
          forecasts, net-worth history, budget goals, and subscription alerts on
          top. Run the whole thing on your own machine, or let us host it — your
          account gets its own isolated database either way.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="Why it exists">
            <p>
              Most personal-finance tools want a live connection to your bank.
              That means handing your credentials — and a continuous feed of every
              purchase — to a third-party aggregator. Pare takes the opposite bet:
              the statements you already receive are enough. They&apos;re
              authoritative, they reconcile to a real closing balance, and they
              never require you to share a login.
            </p>
            <p>
              The trade-off is that you do a little work — dropping in a PDF each
              month — in exchange for keeping your financial life on a machine you
              control. Pare is built for people who&apos;d rather own their data
              than rent visibility into it.
            </p>
            <p>
              And if you do want automatic sync, it stays on your terms:
              Pare has an opt-in{" "}
              <a
                href="https://www.simplefin.org/"
                className="link"
                target="_blank"
                rel="noreferrer"
              >
                SimpleFIN
              </a>{" "}
              connection — a read-only bridge you pay directly and can revoke any
              time. Your bank login lives at the bridge, never in Pare, and the
              default is always off.
            </p>
          </Section>

          <Section title="What it does">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Parses bank and credit-card PDF statements — and OFX/QFX exports
                from any bank — into clean, deduplicated transactions.
              </li>
              <li>
                Categorizes spending with first-match keyword rules you can edit,
                add to, or override per transaction.
              </li>
              <li>
                Shows monthly trends, category breakdowns, income vs. spend, a
                discretionary baseline, and a daily-spend heatmap.
              </li>
              <li>
                Tracks net worth from statement balances plus manual entries for
                things like investments and vehicles.
              </li>
              <li>
                Forecasts cash flow 30/60/90 days out and flags recurring charges
                and double-bills.
              </li>
              <li>
                Lets you ask questions in plain language through an{" "}
                <Link href="/mcp" className="link">
                  MCP server for Claude
                </Link>{" "}
                — a one-URL claude.ai connector on hosted, fully local when you
                self-host.
              </li>
            </ul>
          </Section>

          <Section title="What we believe">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1px] bg-border border border-border mt-1">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="bg-card p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="inline-block w-2.5 h-2.5 shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <h3 className="font-mono text-xs tracking-widest uppercase">
                      {p.title}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="How it's built">
            <p>
              Pare is a Next.js app with a SQLite database, a Python parser for PDF
              ingestion, and Recharts for the visualizations — wrapped in a
              brutalist, monochrome interface where colour is reserved for data, not
              chrome. It&apos;s a personal, open-source project, released under the{" "}
              <span className="font-medium">AGPL-3.0 License</span> and built to be run
              by one person, on their own hardware, for their own finances.
            </p>
            <p>
              The code is public. Read it, fork it, file an issue, or self-host your
              own copy:
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-xs tracking-widest uppercase border border-border bg-card px-4 h-10 hover:text-foreground text-muted-foreground transition-colors"
            >
              <GithubMark className="size-4" />
              View on GitHub
            </a>
          </Section>

          <Section title="A note on the numbers">
            <p>
              Pare&apos;s summaries, trends, budgets, net-worth figures, and
              forecasts are estimates generated from the data you provide — not
              financial advice and not a promise of any future outcome. Statements
              also lag the calendar, so the current month is always partial. Use
              Pare to understand your own spending; for decisions about your
              specific situation, talk to a qualified professional. See the{" "}
              <Link href="/terms" className="link">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="link">
                Privacy Policy
              </Link>{" "}
              for the details.
            </p>
          </Section>
        </div>
      </main>

      <MarketingFooter current="/about" />
    </div>
  );
}
