import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";
import { ImportWizard } from "@/components/switch/import-wizard";

// Public migration landing — THE primary switching LP (Scott's call, 2026-07-02:
// /switch is canonical; /switching and /switch-from-monarch re-export it).
// Readable signed-out (middleware PUBLIC_PATHS) so it's crawlable. Merges the
// offer-doc pain-led "Coming from X?" sections (§4.4) with the real import
// wizard: the Monarch/Mint/YNAB CSV import SHIPPED in PR #39 (lib/import/
// normalizer.ts + presets.ts + overlap.ts, /api/import*), so this page claims it
// works — no "coming soon" hedging. The static pitch is server-rendered for SEO;
// the interactive 3-step wizard hydrates below it. The wizard's import APIs stay
// gated — a signed-out visitor sees the pitch and a "sign in to import" prompt.

export const metadata: Metadata = {
  title: "Switch to Pare from Mint, Monarch, YNAB, or a spreadsheet — import your history",
  description:
    "Leaving Mint, Monarch, or YNAB? Import your full transaction history and categories into Pare in three steps — no bank login, just the CSV you already export. Honest answers for each app you're leaving.",
  keywords: [
    "Mint alternative",
    "Mint shut down",
    "Monarch alternative",
    "export Monarch data",
    "switch from Monarch",
    "YNAB alternative",
    "import transactions",
    "personal finance migration",
    "personal finance spreadsheet alternative",
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
      "Pare can't do that to you. The whole app is open source and self-hostable, so it survives the company: if Pare-the-service ever goes away, you run Pare-the-code on your own machine and nothing changes. Bring your Mint CSV export through the importer below — full history, categories included — and from then on you feed it statement PDFs you already have. No bank connection to break, no aggregator to go dark.",
  },
  {
    color: PALETTE.terracotta,
    from: "Coming from Monarch?",
    pain: "$15/month, and it connects straight to your bank. Monarch relies on an aggregator for those live syncs, and its privacy policy allows sharing de-identified data. You're paying to be the product's input.",
    answer:
      "Pare never touches your bank. No aggregator, no stored credentials — you upload a PDF and it's parsed, then the PDF is deleted. Export your Monarch history to CSV and the importer below brings every transaction and category with you. Your data sits in a database that's only yours, and the code that handles it is public. Nothing about you is sold or shared.",
  },
  {
    color: PALETTE.dustyblue,
    from: "Coming from YNAB?",
    pain: "YNAB is zero-based envelope budgeting: assign every dollar a job, before you spend it. That's a discipline, and for people who stick with it, it works.",
    answer:
      "Pare is a different paradigm, and we'd rather say so than pretend. It reads your statements after the fact and shows you where the money actually went — trends, categories, subscriptions, forecasts. It's analysis, not envelopes. If budgeting-before-you-spend is the habit you want, YNAB does that and Pare doesn't. If you want to see the truth of last month in ten minutes, that's Pare — and the importer below reads your YNAB register export.",
  },
  {
    color: PALETTE.wheat,
    from: "Coming from a spreadsheet?",
    pain: "You built the thing yourself, which means you also maintain it: pasting exports, fixing formulas, re-categorizing rows, rebuilding the pivot table every month. The upkeep is the tax.",
    answer:
      "Pare is the spreadsheet you don't have to maintain. Drop a PDF and the category breakdown, month-over-month delta, and subscription list build themselves. You keep the control a spreadsheet gives you — export everything to CSV or JSON anytime, or self-host the whole thing — without the monthly rebuild.",
  },
];

const IMPORT_SOURCES = [
  { color: PALETTE.terracotta, name: "Monarch Money", note: "CSV export → full history + categories" },
  { color: PALETTE.celadon, name: "Mint", note: "Transactions CSV (debit/credit aware)" },
  { color: PALETTE.dustyblue, name: "YNAB", note: "Register CSV (Outflow/Inflow)" },
];

const STEPS = [
  { n: "01", title: "Upload your export", body: "Drop the CSV you exported. Pare auto-detects the source app and reads every row — nothing is written yet." },
  { n: "02", title: "Map accounts & categories", body: "Confirm which account is a card vs. chequing and how foreign categories map to Pare's. Sensible defaults are filled in." },
  { n: "03", title: "Review & import", body: "See a sample and the date range, then import. It's tagged for one-click undo, and later PDF uploads won't double-count the overlap." },
];

export default function SwitchPage() {
  return (
    <div className="min-h-full flex flex-col bg-background">
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
          do for you? Straight answers below — and the importer that brings your
          history with you, three steps, no bank login.
        </p>

        {/* Pain-led sections, one per source */}
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
            </div>
          ))}
        </div>

        {/* The one-line version */}
        <section className="border-t border-border mt-10 pt-6">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">
            The one-line version
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-foreground/90">
            <li>
              <span className="font-medium">vs. Mint:</span> it can&apos;t shut down on
              you — open source and self-hostable.
            </li>
            <li>
              <span className="font-medium">vs. Monarch:</span> no bank connection, no
              aggregator, nothing sold.
            </li>
            <li>
              <span className="font-medium">vs. YNAB:</span> analysis after the fact,
              not envelope budgeting before it.
            </li>
            <li>
              <span className="font-medium">vs. a spreadsheet:</span> same control,
              none of the monthly upkeep.
            </li>
          </ul>
        </section>

        {/* Bring your history — the real importer */}
        <section className="border-t border-border mt-10 pt-8">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-2">
            Bring your history. Keep your past.
          </h2>
          <p className="text-sm leading-relaxed text-foreground/90 max-w-2xl mb-6">
            The thing that locks you into a finance app is your history. Pare
            dissolves that lock: export your transactions from Monarch, Mint, or YNAB
            and import them here — every transaction <em>and</em> your categories —
            in three steps. No bank login, no aggregator, just the CSV you already
            have.
          </p>

          {/* Supported sources */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-[1px] bg-border border border-border">
            {IMPORT_SOURCES.map((s) => (
              <div key={s.name} className="bg-card p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-block w-2.5 h-2.5 shrink-0" style={{ backgroundColor: s.color }} />
                  <h3 className="font-mono text-xs tracking-widest uppercase">{s.name}</h3>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{s.note}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="mt-8 space-y-[1px] bg-border border border-border">
            {STEPS.map((s) => (
              <div key={s.n} className="bg-card p-4 flex gap-4">
                <span className="font-mono text-sm font-bold text-muted-foreground">{s.n}</span>
                <div>
                  <h3 className="font-mono text-xs tracking-widest uppercase">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The wizard */}
        <section className="border-t border-border mt-10 pt-8">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-4">Import your data</h2>
          <ImportWizard />
        </section>

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

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-8">
          Pare reads only files you export yourself — there is no scraping or
          automated login. Your data is parsed and stored on the machine running
          Pare. See the{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
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
