import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";

// Public "MCP for Claude" explainer. Reachable signed-out, exactly like /about,
// /privacy and /terms: hosted mode retires the auth gate, and self-host adds
// "/mcp" to the gate's PUBLIC_PATHS (middleware.ts). The Sidebar hides itself
// here (components/layout/navbar.tsx), so this page renders its own chrome.
//
// This is the MARKETING/concept page — what the MCP server is, the tools it
// exposes, and what you can ask. The machine-specific copy-paste config (with
// absolute paths) lives on the signed-in /connect page, which this links to.

export const metadata: Metadata = {
  title: "MCP for Claude — PARE",
  description:
    "Pare ships a local Model Context Protocol server so you can ask Claude about your spending in plain language. It runs on your machine, reads only your local database, and makes no network calls.",
};

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

const READ_TOOLS = [
  ["spending_summary", "monthly totals, category breakdown, top merchants"],
  ["list_transactions", "filter by category, source, flow, date range, search"],
  ["category_breakdown", "spend per category, optionally one month"],
  ["income_summary", "income by type + income-vs-spend series"],
  ["cashflow", "net cashflow per month + period surplus"],
  ["baseline", "discretionary baseline with large one-offs removed"],
  ["subscriptions", "detected recurring charges + double-bill flags"],
  ["goals_status", "goal progress for the latest data month"],
  ["insights", "auto tips: over-budget, MoM moves, one-offs"],
  ["list_categories", "categories in use + keyword rules"],
] as const;

const WRITE_TOOLS = [
  ["set_goal", "set a category's monthly limit"],
  ["delete_goal", "remove a category's monthly limit"],
  ["add_category_rule", "add a keyword→category rule"],
  ["delete_category_rule", "remove a keyword→category rule"],
  ["recategorize_all", "re-apply rules to all transactions"],
  ["tag_transaction", "override one transaction's category"],
] as const;

const EXAMPLE_PROMPTS = [
  "How much did I spend on restaurants last month?",
  "What subscriptions am I paying for?",
  "Set a $400 restaurant budget.",
  "Which categories are pacing over budget this month?",
  "Show me my biggest one-off purchases this year.",
  "Am I on track to finish the month with a surplus?",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-sm font-bold tracking-widest uppercase mb-3">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function McpPage() {
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

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>MCP for Claude</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Ask Claude about your money.
        </h1>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare ships a local{" "}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Model Context Protocol
          </a>{" "}
          server that exposes your finance data as 16 tools an MCP client — Claude
          Code or Claude Desktop — can call. Connect it once and you can ask Claude
          about your spending, budgets, and subscriptions in plain language, with
          the answers grounded in your actual transactions.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="How it works">
            <p>
              MCP is an open standard for giving an AI assistant access to tools and
              data. Pare&apos;s server speaks it over stdio: Claude calls a tool like{" "}
              <span className="font-mono text-xs">spending_summary</span>, the server
              reads your local SQLite database, and hands back the numbers. Claude
              then explains them in conversation.
            </p>
            <p>
              The server runs on your own machine and{" "}
              <span className="font-medium">makes no network calls</span> — it reads
              and writes only the local database. The Python parser and this MCP
              server both bypass the web app entirely, so they work the same whether
              you self-host or run Pare locally.
            </p>
          </Section>

          <Section title="What you can ask">
            <div className="border border-border">
              <div className="border-b border-border px-3 h-8 flex items-center">
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                  Try prompts like
                </span>
              </div>
              <ul className="p-3 space-y-1.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <li key={p} className="text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">&gt;</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title="The tools">
            <p>
              Ten read tools answer questions; six write tools let Claude set goals,
              tune categorization rules, and re-tag transactions — so you can keep
              your data organized by asking, not clicking.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-border border border-border mt-1">
              <div className="bg-card p-5">
                <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2 mb-4">
                  <span
                    className="inline-block w-2.5 h-2.5"
                    style={{ backgroundColor: PALETTE.sage }}
                  />
                  READ · {READ_TOOLS.length}
                </h3>
                <ul className="space-y-2">
                  {READ_TOOLS.map(([name, desc]) => (
                    <li key={name} className="text-xs">
                      <span className="font-mono">{name}</span>
                      <span className="text-muted-foreground"> — {desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-card p-5">
                <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2 mb-4">
                  <span
                    className="inline-block w-2.5 h-2.5"
                    style={{ backgroundColor: PALETTE.terracotta }}
                  />
                  WRITE · {WRITE_TOOLS.length}
                </h3>
                <ul className="space-y-2">
                  {WRITE_TOOLS.map(([name, desc]) => (
                    <li key={name} className="text-xs">
                      <span className="font-mono">{name}</span>
                      <span className="text-muted-foreground"> — {desc}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="Privacy">
            <p>
              The server touches only your local database and uploads nothing on its
              own. Be aware, though, that whatever an AI client reads through these
              tools is sent to that client&apos;s model provider as conversation
              context — so connect only clients you trust with your financial data.
            </p>
          </Section>

          <Section title="Setting it up">
            <p>
              Setup is a small block of JSON added to your Claude Code or Claude
              Desktop config. Because the paths have to be absolute for your machine,
              Pare generates the exact, copy-paste-ready snippet for you on the{" "}
              <Link href="/connect" className="underline">
                Connect page
              </Link>{" "}
              once you&apos;re signed in — along with a one-line smoke test to verify
              the server before you wire it into a client.
            </p>
          </Section>
        </div>
      </main>

      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between">
        <Link
          href="/about"
          className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          About
        </Link>
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
