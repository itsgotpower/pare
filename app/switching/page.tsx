import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";

// Public "coming from X?" landing — the switcher-fear asset from the offer doc
// (§4.4). Highest-intent audience on the internet: people already leaving Mint,
// Monarch, YNAB, or a spreadsheet. Reachable signed-out (middleware PUBLIC_PATHS
// + WAITLIST_PUBLIC; Sidebar hides itself here).
//
// HONESTY RULE: the Monarch/Mint import is on the roadmap, NOT shippable today
// (the account_kind groundwork exists; the normalizer + UI don't). This page
// sets that expectation plainly — "bookmark this, we'll email when it ships" —
// and never claims an import that isn't there. Do not add a live import CTA here
// until the migration tool actually lands.

export const metadata: Metadata = {
  title: "Coming from Mint, Monarch, YNAB, or a spreadsheet? — PARE",
  description:
    "Leaving Mint, Monarch, YNAB, or a spreadsheet? What Pare does differently — PDF in, no bank login, no data selling, open source — and honestly where import stands.",
  keywords: [
    "Mint alternative",
    "Monarch alternative",
    "YNAB alternative",
    "Mint shut down",
    "personal finance spreadsheet alternative",
    "switch personal finance app",
  ],
};

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

// One section per switching source. `pain` is the specific thing they're leaving;
// `answer` is Pare's concrete mechanism, not an adjective.
const SOURCES = [
  {
    color: PALETTE.celadon,
    from: "Coming from Mint?",
    pain: "The company shut it down. Intuit killed Mint in 2024 and pushed users to Credit Karma — millions of people lost the tool they'd used for years, on someone else's timeline.",
    answer:
      "Pare can't do that to you. The whole app is open source and self-hostable, so it survives the company: if Pare-the-service ever goes away, you run Pare-the-code on your own machine and nothing changes. You give it statement PDFs you already have — no bank connection to break, no aggregator to go dark.",
  },
  {
    color: PALETTE.terracotta,
    from: "Coming from Monarch?",
    pain: "$15/month, and it connects straight to your bank. Monarch relies on an aggregator for those live syncs, and its privacy policy allows sharing de-identified data. You're paying to be the product's input.",
    answer:
      "Pare never touches your bank. No aggregator, no stored credentials — you upload a PDF and it's parsed, then the PDF is deleted. Your transactions sit in a database that's only yours, and the code that handles them is public. Nothing about you is sold or shared.",
  },
  {
    color: PALETTE.dustyblue,
    from: "Coming from YNAB?",
    pain: "YNAB is zero-based envelope budgeting: assign every dollar a job, before you spend it. That's a discipline, and for people who stick with it, it works.",
    answer:
      "Pare is a different paradigm, and we'd rather say so than pretend. It reads your statements after the fact and shows you where the money actually went — trends, categories, subscriptions, forecasts. It's analysis, not envelopes. If budgeting-before-you-spend is the habit you want, YNAB does that and Pare doesn't. If you want to see the truth of last month in ten minutes, that's Pare.",
  },
  {
    color: PALETTE.wheat,
    from: "Coming from a spreadsheet?",
    pain: "You built the thing yourself, which means you also maintain it: pasting exports, fixing formulas, re-categorizing rows, rebuilding the pivot table every month. The upkeep is the tax.",
    answer:
      "Pare is the spreadsheet you don't have to maintain. Drop a PDF and the category breakdown, month-over-month delta, and subscription list build themselves. You keep the control a spreadsheet gives you — export everything to CSV or JSON anytime, or self-host the whole thing — without the monthly rebuild.",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function SwitchingPage() {
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
        <p className={labelClass}>Switching to Pare</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          You&apos;re already leaving. Here&apos;s the honest pitch.
        </h1>
        <p className="text-sm leading-relaxed text-foreground/90 mt-6 max-w-2xl">
          Mint&apos;s gone, Monarch charges rent, YNAB is a different sport, and the
          spreadsheet is a second job. Whatever you&apos;re coming from, the question
          is the same: what does Pare actually do differently, and what won&apos;t it
          do for you? Straight answers below — including where import really stands.
        </p>

        <div className="mt-8 space-y-[1px] bg-border border border-border">
          {SOURCES.map((s) => (
            <div key={s.from} className="bg-card p-5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <h2 className="font-mono text-sm font-bold tracking-widest uppercase">{s.from}</h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed mt-2">{s.pain}</p>
              <p className="text-sm text-foreground/90 leading-relaxed mt-2">{s.answer}</p>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors mt-3"
              >
                Join the waitlist →
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-8">
          <Section title="What about my history?">
            <p>
              The real fear in switching is losing years of transactions. Here&apos;s
              the honest state of it:{" "}
              <span className="font-medium">
                a one-click Monarch/Mint import is on the roadmap, not shipped yet.
              </span>{" "}
              The groundwork exists in the code, but the importer and its UI
              don&apos;t — so we&apos;re not going to tell you it works today.
            </p>
            <p>
              What works right now: upload your statement PDFs and Pare reads the full
              history off them, no import tool required. When the direct Monarch/Mint
              import lands, we&apos;ll email everyone on the waitlist. Bookmark this
              page and join below — that&apos;s how you&apos;ll hear about it first.
            </p>
          </Section>

          <Section title="The one-line version">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium">vs. Mint:</span> it can&apos;t shut down
                on you — open source and self-hostable.
              </li>
              <li>
                <span className="font-medium">vs. Monarch:</span> no bank connection,
                no aggregator, nothing sold.
              </li>
              <li>
                <span className="font-medium">vs. YNAB:</span> analysis after the
                fact, not envelope budgeting before it.
              </li>
              <li>
                <span className="font-medium">vs. a spreadsheet:</span> same control,
                none of the monthly upkeep.
              </li>
            </ul>
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
            href="/how-it-works"
            className="font-mono text-[11px] tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            How the parsing works →
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
            href="/how-it-works"
            className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            How it works
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
