import { NextRequest } from "next/server";
import { isHostedMode } from "@/lib/auth/resolve";

// POST /api/mcp-disconnect — sever the claude.ai remote-MCP connector for the
// signed-in user (the /profile SECURITY card's "Disconnect Claude"). Deletes the
// user's OAuth tokens + consent rows in the D1 AUTH database, so the connector's
// next call 401s and a reconnect re-runs consent (lib/auth/mcp-connection.ts).
//
// Hosted-only: self-host's stdio MCP server has no OAuth grant to revoke —
// removing the server from the MCP client's own config is the disconnect there —
// so the route 404s in self-host, like the other hosted-mode surfaces.
export async function POST(request: NextRequest) {
  if (!isHostedMode()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { createHostedAuth } = await import("@/lib/auth/hosted");
  const { getD1 } = await import("@/lib/auth/d1");
  const d1 = await getD1();
  const auth = createHostedAuth(d1);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { revokeMcpConnection } = await import("@/lib/auth/mcp-connection");
  const { revokedTokens } = await revokeMcpConnection(d1, session.user.id);
  return Response.json({ ok: true, revoked: revokedTokens });
}
