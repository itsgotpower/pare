/**
 * Pare — finance MCP server (stdio).
 *
 * Exposes the local SQLite finance data (data/pare.db) as MCP tools so an MCP
 * client (e.g. Claude) can query and lightly manage spending. Goes through the
 * app's Repo layer — single source of truth, no duplicated SQL.
 *
 * The tools themselves live in mcp/tools.ts (registerPareTools), SHARED with
 * the hosted remote-MCP endpoint (app/api/mcp/route.ts) — add or change tools
 * there, not here. This entry point owns only the self-host specifics: the
 * module-level repo, seeding, and the stdio transport.
 *
 * Privacy: reads/writes ONLY the local DB. Set PARE_DB_PATH to the absolute DB
 * path (the server's cwd is whatever the MCP client launches it with).
 *
 * Run:  PARE_DB_PATH=/abs/path/data/pare.db npx tsx mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../package.json";
import { getRepo } from "../lib/repo";
import { registerPareTools } from "./tools";

// Version comes from package.json (single source of truth — same value the web
// app surfaces via NEXT_PUBLIC_APP_VERSION). Keep it off a hardcoded literal so
// a release bump can't leave the MCP server reporting a stale version.
const server = new McpServer({ name: "pare-finance", version: pkg.version });

registerPareTools(server, getRepo());

async function main() {
  // Ensure schema + built-in/user rules exist before serving (opens the DB).
  await getRepo().categories.seed();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
