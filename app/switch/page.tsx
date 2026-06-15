import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";
import { ImportWizard } from "@/components/switch/import-wizard";

// Public migration landing — readable signed-out (added to middleware
// PUBLIC_PATHS) so it's crawlable as the "/switch-from-monarch" SEO target. The
// static hero is server-rendered for SEO; the interactive 3-step wizard hydrates
// below it. The wizard's import APIs stay gated — a signed-out visitor sees the
// pitch and a "sign in to import" prompt.

export const metadata: Metadata = {
  title: "Switch to Pare from Monarch, Mint & YNAB — import your history",
  description:
    "Leaving Monarch, Mint, or YNAB? Import your full transaction history and categories into Pare in three steps — no bank login, just the CSV you already export. Bring your data, keep your past.",
  keywords: [
    "Monarch alternative",
    "export Monarch data",
    "switch from Monarch",
    "Mint alternative",
    "YNAB alternative",
    "import transactions",
    "personal finance migration",
  ],
};

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

const SOURCES = [
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
        <p className={labelClass}>Switch to Pare</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Bring your history. Keep your past.
        </h1>
        <p className="text-sm leading-relaxed text-foreground/90 mt-6 max-w-2xl">
          The thing that locks you into a finance app is your history. Pare dissolves that lock:
          export your transactions from Monarch, Mint, or YNAB and import them here — every
          transaction <em>and</em> your categories — in three steps. No bank login, no aggregator,
          just the CSV you already have.
        </p>

        {/* Supported sources */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[1px] bg-border border border-border mt-8">
          {SOURCES.map((s) => (
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

        {/* The wizard */}
        <section className="border-t border-border mt-10 pt-8">
          <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-4">Import your data</h2>
          <ImportWizard />
        </section>

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-8">
          Pare reads only files you export yourself — there is no scraping or automated login. Your
          data is parsed and stored on the machine running Pare. See the{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
