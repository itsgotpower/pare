import { withMcpAuth } from "better-auth/plugins";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import pkg from "@/package.json";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";
import { getRepoForUser } from "@/lib/repo";
import { registerPareTools } from "@/mcp/tools";
import { allowRequest, tooManyRequests } from "@/lib/ratelimit";
import { requireFeature } from "@/cloud/billing/gate";
import { withScopeChallenge, withMcpCors, mcpCorsPreflight } from "@/lib/auth/mcp-challenge";

// Remote MCP endpoint for claude.ai Connectors (spec: internal/remote-mcp-spec.md).
//
// STATELESS Streamable HTTP: every POST builds a fresh McpServer + transport
// over the CALLER's own Durable-Object repo, serves the single JSON-RPC
// exchange, and tears down — no session ids, no SSE stream to resume
// (sessionIdGenerator: undefined + enableJsonResponse). All Pare tools are
// request/response, so statefulness would buy nothing and cost a DO per
// conversation.
//
// Auth: withMcpAuth (better-auth mcp plugin) resolves the Bearer access token
// minted by the OAuth flow; an unauthenticated request gets the 401 +
// WWW-Authenticate challenge pointing at the protected-resource metadata,
// which is what triggers claude.ai's connect UX. The middleware passes /api/*
// through untouched, so this route owns its own auth entirely.
//
// Tenancy: session.userId → getRepoForUser → that user's DO. Same isolation-
// by-construction as every API route; there is no code path to another user's
// data. Logging: tool payloads carry merchants/amounts — log NOTHING here
// beyond what the platform already captures (Sentry strips PII in beforeSend).

async function handler(request: Request): Promise<Response> {
  // Self-host has no OAuth provider; its MCP story is the local stdio server.
  if (!isHostedMode()) {
    return withMcpCors(
      Response.json(
        { error: "The remote MCP connector is a hosted feature. Self-host uses the local stdio server (npm run mcp)." },
        { status: 404 }
      )
    );
  }

  const auth = createHostedAuth(await getD1());

  // Cast: hostedAuthOptions() returns the erased BetterAuthOptions type, so the
  // Auth type loses the mcp() plugin's getMcpSession endpoint that withMcpAuth
  // constrains on. It exists at runtime — mcp() is always in the plugin array.
  const wrapped = withMcpAuth(auth as unknown as Parameters<typeof withMcpAuth>[0], async (req, session) => {
    // Per-USER rate limit (not per-IP — connector traffic egresses from
    // Anthropic's IPs, so IP-keying would pool every user into one bucket).
    // Fail-open like every limiter when the binding is unwired.
    if (!(await allowRequest("RL_MCP", `u:${session.userId}`))) {
      return tooManyRequests();
    }

    // Entitlement gate. `mcp_connector` is currently in EVERY plan's feature
    // set (wired-but-on, per the spec's billing posture) — this check is the
    // enforcement point that makes a future tier flip config-only.
    if (!(await requireFeature(session.userId, "mcp_connector"))) {
      return Response.json(
        { error: "The Claude connector is not included in your plan." },
        { status: 403 }
      );
    }

    const server = new McpServer({ name: "pare-finance", version: pkg.version });
    registerPareTools(server, await getRepoForUser(session.userId));

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  });
  return withMcpCors(withScopeChallenge(await wrapped(request)));
}

// CORS preflight: claude.ai's web client sends OPTIONS from the https://claude.ai
// origin before its POST. Answer it directly (no auth) with the allow-methods/
// headers set, or the browser blocks the real request → "Couldn't connect to
// the server." See withMcpCors in lib/auth/mcp-challenge.ts.
export function OPTIONS(): Response {
  return mcpCorsPreflight();
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
