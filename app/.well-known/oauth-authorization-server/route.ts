import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";
import { withMcpCors, mcpCorsPreflight } from "@/lib/auth/mcp-challenge";

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
  // hostedAuthOptions() returns the erased BetterAuthOptions type, so the Auth
  // type loses the mcp() plugin's contributed endpoints and this helper's
  // constraint rejects it. The endpoint exists at runtime — mcp() is always in
  // the plugin array (lib/auth/hosted.ts).
  const upstream = await oAuthDiscoveryMetadata(
    auth as unknown as Parameters<typeof oAuthDiscoveryMetadata>[0]
  )(request);
  // Rewrite the authorization endpoint to the forced-consent shim
  // (app/api/mcp-authorize) — the plugin hard-codes ${baseURL}/mcp/authorize,
  // which grants silently unless the client volunteers prompt=consent. This
  // root document is the one clients actually resolve (RFC 8414: issuer-root
  // well-known; issuer = baseURL), so rewriting here covers the flow.
  const metadata = (await upstream.json()) as Record<string, unknown>;
  metadata.authorization_endpoint = new URL("/api/mcp-authorize", request.url).toString();
  // Honest OAuth 2.1, not OIDC. The plugin hard-codes an OIDC-shaped document:
  // scopes_supported with openid/profile/email (which made claude.ai request
  // an id_token our provider can't correctly mint — HS256, no `iss` claim),
  // id_token_signing_alg_values_supported claiming RS256 (it signs HS256), and
  // a jwks_uri that 404s (the JWKS route lives in better-auth's jwt plugin,
  // which we don't mount). Advertise only what we honor: offline_access for
  // refresh tokens; both OIDC fields removed (optional under RFC 8414).
  metadata.scopes_supported = ["offline_access"];
  delete metadata.jwks_uri;
  delete metadata.id_token_signing_alg_values_supported;
  // Re-wrapping in a fresh Response drops any header the plugin set, so CORS
  // must be re-applied here — claude.ai resolves this doc cross-origin (RFC 8414
  // issuer-root) and the browser blocks it without Allow-Origin.
  return withMcpCors(
    Response.json(metadata, { headers: { "cache-control": "no-store" } })
  );
}

// Preflight for the cross-origin discovery fetch.
export function OPTIONS(): Response {
  return mcpCorsPreflight();
}
