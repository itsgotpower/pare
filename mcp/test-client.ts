/**
 * Smoke test for the Parse MCP server: spawns it over stdio, lists tools, and
 * calls a few read tools + one write tool. Run: npx tsx mcp/test-client.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "parse.db");

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts"],
    env: { ...process.env, PARSE_DB_PATH: dbPath } as Record<string, string>,
  });

  const client = new Client({ name: "parse-test", version: "0.0.1" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(`TOOLS (${tools.tools.length}):`, tools.tools.map((t) => t.name).join(", "));

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[])
      .map((c) => c.text ?? "")
      .join("");
    const oneLine = text.replace(/\s+/g, " ").slice(0, 160);
    console.log(`\n# ${name}(${JSON.stringify(args)})\n${oneLine}${text.length > 160 ? " …" : ""}`);
  }

  await call("spending_summary", { months: 3 });
  await call("cashflow");
  await call("subscriptions");
  await call("insights");
  await call("goals_status");
  await call("set_goal", { category: "Coffee", monthly_limit: 60 });
  await call("goals_status");
  await call("delete_goal", { category: "Coffee" });

  await client.close();
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
