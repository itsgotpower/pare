import path from "node:path";
import { CopyBlock } from "@/components/connect/copy-block";
import { Card, CardContent } from "@/components/ui/card";
import { PALETTE } from "@/lib/colors";
import { isHostedMode } from "@/lib/auth/resolve";

// Paths (self-host) / the connector URL (hosted) are computed per-request so
// the snippets always reflect this deployment.
export const dynamic = "force-dynamic";

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
];

function ToolsGrid() {
  return (
    <>
      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
        AVAILABLE TOOLS
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-border border border-border mb-8">
        <div className="bg-card p-6">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2 mb-4">
            <span className="inline-block w-2.5 h-2.5" style={{ backgroundColor: PALETTE.sage }} />
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
        <div className="bg-card p-6">
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
    </>
  );
}

function ExamplePrompts() {
  return (
    <div className="border border-border">
      <div className="border-b border-border px-3 h-8 flex items-center">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          THEN ASK CLAUDE THINGS LIKE
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
  );
}

// Hosted: the remote MCP connector — claude.ai Settings → Connectors, one URL,
// zero terminal. OAuth (better-auth mcp plugin) handles sign-in + consent; the
// per-user Durable Object keeps tool calls scoped to the caller's own data.
function HostedConnect() {
  // BETTER_AUTH_URL is the deployment's canonical origin (required in hosted
  // prod for cookie/passkey config); the connector endpoint lives under it.
  const base = process.env.BETTER_AUTH_URL ?? "https://pare.money";
  const connectorUrl = `${base.replace(/\/$/, "")}/api/mcp`;

  const steps = [
    ["1", "Open Claude", "claude.ai → Settings → Connectors (web, desktop, or mobile)"],
    ["2", "Add custom connector", "paste the URL below and confirm"],
    ["3", "Approve access", "sign in to Pare if asked, review the consent screen, ALLOW"],
  ] as const;

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">CONNECT</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Talk to Claude about your money — one click, no terminal
        </p>
      </div>

      {/* ADD TO CLAUDE hero */}
      <div className="border border-border mb-8">
        <div className="border-b border-border px-4 h-9 flex items-center">
          <span className="font-mono text-[10px] tracking-widest uppercase">
            ADD TO CLAUDE
          </span>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-border border border-border">
            {steps.map(([n, title, detail]) => (
              <div key={n} className="bg-card p-4">
                <div className="font-mono text-xs tracking-widest uppercase mb-1">
                  <span className="text-muted-foreground">{n} · </span>
                  {title}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
          <CopyBlock label="CONNECTOR URL" text={connectorUrl} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Claude connects with its own scoped access token — it never sees your
            Pare password. Every write tool call still asks for your approval
            inside Claude, and you can disconnect anytime from Claude&apos;s
            connector settings.
          </p>
        </div>
      </div>

      <ToolsGrid />

      <div className="mb-8">
        <ExamplePrompts />
      </div>

      {/* PRIVACY */}
      <Card className="mb-8">
        <CardContent className="py-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            PRIVACY
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Tool calls are scoped to your account&apos;s data and nothing else —
            but whatever Claude reads through these tools becomes conversation
            context at the model provider. Connect only if you&apos;re
            comfortable with that; disconnecting revokes the token.
          </p>
        </CardContent>
      </Card>

      {/* PREFER LOCAL */}
      <Card>
        <CardContent className="py-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            PREFER FULLY LOCAL?
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Self-hosted Pare ships the same {READ_TOOLS.length + WRITE_TOOLS.length} tools
            as a local stdio MCP server — zero network, your data never leaves the
            machine. See{" "}
            <a
              href="https://github.com/itsgotpower/pare"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              the open-source repo
            </a>{" "}
            to run it yourself.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Self-host: the local stdio server, configured by absolute paths computed for
// THIS machine per request.
function SelfHostConnect() {
  const root = process.cwd();
  const dbPath = process.env.PARE_DB_PATH ?? path.join(root, "data", "pare.db");
  const nodeBin = process.execPath;
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const serverEntry = path.join(root, "mcp", "server.ts");

  const serverConfig = {
    "pare-finance": {
      type: "stdio",
      command: nodeBin,
      args: [tsxCli, serverEntry],
      cwd: root,
      env: { PARE_DB_PATH: dbPath },
    },
  };

  const claudeCodeJson = JSON.stringify({ mcpServers: serverConfig }, null, 2);
  // Claude Desktop's config has no `cwd` field, but the server must run from the
  // repo root (migrations resolve via process.cwd()) — so wrap in a shell `cd`.
  const claudeDesktopJson = JSON.stringify(
    {
      mcpServers: {
        "pare-finance": {
          command: "/bin/sh",
          args: ["-c", `cd '${root}' && exec '${nodeBin}' '${tsxCli}' '${serverEntry}'`],
          env: { PARE_DB_PATH: dbPath },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="font-mono text-2xl font-bold tracking-tight uppercase">CONNECT</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Query your finance data from Claude via the built-in MCP server
        </p>
      </div>

      <Card className="mb-8">
        <CardContent className="py-5">
          <p className="text-sm leading-relaxed">
            Pare ships a local{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              Model Context Protocol
            </a>{" "}
            server that exposes your data as {READ_TOOLS.length + WRITE_TOOLS.length} tools an MCP client (Claude Code, Claude
            Desktop) can call. It talks stdio, reads and writes only the local SQLite
            database, and makes <span className="font-medium">no network calls</span> —
            everything stays on this machine.
          </p>
        </CardContent>
      </Card>

      <ToolsGrid />

      {/* SETUP */}
      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
        SETUP — CLAUDE CODE
      </h2>
      <div className="space-y-3 mb-8">
        <p className="text-xs text-muted-foreground">
          Add the server under <span className="font-mono">mcpServers</span> in{" "}
          <span className="font-mono">~/.claude.json</span> (user scope — available in every
          project), then restart Claude Code. Paths below are already absolute for this
          machine.
        </p>
        <CopyBlock label="~/.claude.json" text={claudeCodeJson} />
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">cwd</span> must stay the repo root — database
          migrations resolve relative to it. Verify with <span className="font-mono">/mcp</span>{" "}
          inside Claude Code: <span className="font-mono">pare-finance</span> should be
          listed as connected.
        </p>
      </div>

      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
        SETUP — CLAUDE DESKTOP
      </h2>
      <div className="space-y-3 mb-8">
        <p className="text-xs text-muted-foreground">
          Open Settings → Developer → Edit Config, or edit the file directly. Claude
          Desktop has no <span className="font-mono">cwd</span> option, so this variant
          wraps the command in a shell <span className="font-mono">cd</span>:
        </p>
        <CopyBlock
          label="~/Library/Application Support/Claude/claude_desktop_config.json"
          text={claudeDesktopJson}
        />
        <p className="text-xs text-muted-foreground">
          Restart Claude Desktop; the tools appear under the 🔌 connectors menu.
        </p>
      </div>

      {/* VERIFY */}
      <h2 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-4">
        VERIFY
      </h2>
      <div className="space-y-3 mb-8">
        <p className="text-xs text-muted-foreground">
          Smoke-test the server outside any client (lists tools and runs a sample query):
        </p>
        <CopyBlock label="terminal — from the repo root" text={`npx tsx mcp/test-client.ts`} />
        <ExamplePrompts />
      </div>

      {/* PRIVACY */}
      <Card>
        <CardContent className="py-5">
          <h3 className="font-mono text-xs tracking-widest uppercase text-muted-foreground mb-2">
            PRIVACY
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The MCP server runs locally and touches only{" "}
            <span className="font-mono">{dbPath}</span>. Nothing is uploaded by Pare — but
            note that whatever an AI client reads through these tools is sent to that
            client&apos;s model provider as conversation context. Connect only clients you
            trust with your financial data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConnectPage() {
  return isHostedMode() ? <HostedConnect /> : <SelfHostConnect />;
}
