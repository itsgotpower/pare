import Link from "next/link";
import type { Metadata } from "next";
import { PALETTE } from "@/lib/colors";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

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
    "Pare speaks the Model Context Protocol so you can ask Claude about your spending in plain language — a one-URL claude.ai connector on the hosted service, or a fully local server if you self-host.",
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
  ["add_manual_transaction", "record a cash / off-statement purchase"],
  ["delete_manual_transaction", "delete a manually recorded transaction"],
] as const;

const EXAMPLE_PROMPTS = [
  "How much did I spend on restaurants last month?",
  "What subscriptions am I paying for?",
  "Set a $400 restaurant budget.",
  "I spent $40 cash at the market.",
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
      <MarketingHeader />

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>MCP for Claude</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Ask Claude about your money.
        </h1>

        <p className="text-sm leading-relaxed text-foreground/90 mt-6">
          Pare speaks the{" "}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            Model Context Protocol
          </a>
          , exposing your finance data as {READ_TOOLS.length + WRITE_TOOLS.length} tools an MCP client can call.
          On the hosted service that&apos;s a one-URL connector you add to claude.ai
          (web, desktop, or mobile); self-host ships a fully local server for Claude
          Code and Claude Desktop. Connect it once and you can ask Claude about your
          spending, budgets, and subscriptions in plain language, with the answers
          grounded in your actual transactions.
        </p>

        <div className="mt-8 space-y-8">
          <Section title="How it works">
            <p>
              MCP is an open standard for giving an AI assistant access to tools and
              data. Claude calls a tool like{" "}
              <span className="font-mono text-xs">spending_summary</span>, Pare reads
              your database, and hands back the numbers. Claude then explains them
              in conversation.
            </p>
            <p>
              <span className="font-medium">Hosted:</span> add Pare as a custom
              connector in claude.ai — one URL, an OAuth sign-in with explicit
              consent, no terminal. Every tool call runs against your own isolated
              database and nothing else; you can revoke access at any time.
            </p>
            <p>
              <span className="font-medium">Self-host:</span> the server runs on
              your own machine over stdio and{" "}
              <span className="font-medium">makes no network calls</span> — it reads
              and writes only the local database, bypassing the web app entirely.
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
              Ten read tools answer questions; eight write tools let Claude set goals,
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
              The tools touch only your own database — local when you self-host,
              your isolated per-account store on hosted — and upload nothing on
              their own. Be aware, though, that whatever an AI client reads through
              these tools is sent to that client&apos;s model provider as
              conversation context — so connect only clients you trust with your
              financial data.
            </p>
          </Section>

          <Section title="Setting it up">
            <p>
              Hosted: paste one URL into claude.ai&apos;s Settings → Connectors.
              Self-host: add a small block of JSON to your Claude Code or Claude
              Desktop config. Either way, the{" "}
              <Link href="/connect" className="link">
                Connect page
              </Link>{" "}
              shows the exact, copy-paste-ready setup for your account once
              you&apos;re signed in — including a one-line smoke test for the local
              server.
            </p>
          </Section>
        </div>
      </main>

      <MarketingFooter current="/mcp" />
    </div>
  );
}
