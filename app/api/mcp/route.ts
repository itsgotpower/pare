import { withMcpAuth } from "better-auth/plugins";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import pkg from "@/package.json";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";

// Remote MCP endpoint for claude.ai Connectors (spec: internal/remote-mcp-spec.md).
//
// STATELESS Streamable HTTP: every POST builds a fresh McpServer + transport,
// serves the single JSON-RPC exchange, and tears down — no session ids, no SSE
// stream to resume (sessionIdGenerator: undefined + enableJsonResponse). All
// Pare tools are request/response, so statefulness would buy nothing and cost
// a Durable Object per conversation.
//
// Auth: withMcpAuth (better-auth mcp plugin) resolves the Bearer access token
// minted by the OAuth flow; an unauthenticated request gets the 401 +
// WWW-Authenticate challenge pointing at /.well-known/oauth-protected-resource,
// which is what triggers claude.ai's connect/OAuth UX. The middleware passes
// /api/* through untouched, so this route owns its own auth entirely.
//
// S1 SPIKE SCOPE: a single `whoami` echo tool proves the OAuth + transport
// chain end-to-end. Phase 2 replaces it with registerPareTools(server,
// await getRepoForUser(session.userId)) — the shared registry extracted from
// mcp/server.ts — plus the RL_MCP rate limit.

async function handler(request: Request): Promise<Response> {
  // Self-host has no OAuth provider; its MCP story is the local stdio server.
  if (!isHostedMode()) {
    return Response.json(
      { error: "The remote MCP connector is a hosted feature. Self-host uses the local stdio server (npm run mcp)." },
      { status: 404 }
    );
  }

  const auth = createHostedAuth(await getD1());

  return withMcpAuth(auth, async (req, session) => {
    const server = new McpServer({ name: "pare-finance", version: pkg.version });

    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description: "S1 spike tool: echoes the authenticated Pare user id and the granted scopes.",
        inputSchema: { text: z.string().optional() },
      },
      async ({ text }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              echo: text ?? null,
              userId: session.userId,
              clientId: session.clientId,
              scopes: session.scopes,
            }),
          },
        ],
      })
    );

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  })(request);
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
