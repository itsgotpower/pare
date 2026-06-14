// Verifies the registered command works, using repo-relative paths (run from the
// repo root: `npx tsx mcp/verify-registered.ts`).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const repo = process.cwd();

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath, // the running node binary
    args: [
      path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(repo, "mcp", "server.ts"),
    ],
    cwd: repo,
    env: {
      ...process.env,
      PARE_DB_PATH: path.join(repo, "data", "pare.db"),
    } as Record<string, string>,
  });
  const client = new Client({ name: "verify", version: "0.0.1" });
  await client.connect(transport);
  const tools = await client.listTools();
  const res = await client.callTool({ name: "spending_summary", arguments: { months: 1 } });
  const text = (res.content as { text?: string }[]).map((c) => c.text ?? "").join("");
  console.log(`connected, ${tools.tools.length} tools`);
  console.log("spending_summary ok:", text.includes("monthly_totals"));
  await client.close();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
