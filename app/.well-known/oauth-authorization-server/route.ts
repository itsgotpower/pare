import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";

// OAuth 2.1 authorization-server discovery (RFC 8414) for the remote MCP
// connector. claude.ai fetches this before dynamic client registration; the
// better-auth mcp plugin (lib/auth/hosted.ts) generates the document from its
// own endpoint map, so paths never drift from the implementation.
//
// HOSTED-only: self-host has no OAuth provider (its MCP story is the local
// stdio server), so this 404s there rather than advertising endpoints that
// don't exist. Built per-request like every hosted-auth route — the D1 binding
// only exists in the Worker request scope. Spec: internal/remote-mcp-spec.md.

export async function GET(request: Request): Promise<Response> {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const auth = createHostedAuth(await getD1());
  return oAuthDiscoveryMetadata(auth)(request);
}
