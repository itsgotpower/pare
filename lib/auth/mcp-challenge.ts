// Scope hint for the remote MCP connector's 401 challenge.
//
// MCP is OAuth 2.1, not OIDC: the access token maps to a userId server-side,
// so identity scopes (openid/profile/email) buy nothing here — and requesting
// `openid` makes better-auth's oidc-provider mint an id_token that claude.ai
// then validates and REJECTS (HS256-signed, missing the required `iss` claim,
// while our discovery metadata claimed RS256 with a jwks_uri that 404s). That
// rejection surfaced as "Authorization with Pare failed" after a fully
// successful token exchange, with no MCP request ever sent.
//
// claude.ai's documented scope selection: the `scope` param on the 401
// WWW-Authenticate challenge wins; without it, the client falls back to the
// protected-resource metadata's scopes_supported (ALSO set to this value via
// oidcConfig.metadata in lib/auth/hosted.ts — belt and braces). offline_access
// alone keeps refresh tokens; the oidc-provider only mints an id_token when
// the requested scopes include `openid`.
export const MCP_SCOPE = "offline_access";

// Append the scope hint to the plugin's 401 challenge (withMcpAuth only emits
// resource_metadata). Non-401 responses pass through untouched; an existing
// scope param is never clobbered.
export function withScopeChallenge(response: Response): Response {
  if (response.status !== 401) return response;
  const existing = response.headers.get("www-authenticate");
  if (!existing || existing.includes("scope=")) return response;
  const headers = new Headers(response.headers);
  headers.set("www-authenticate", `${existing}, scope="${MCP_SCOPE}"`);
  return new Response(response.body, { status: response.status, headers });
}

// CORS for the /api/mcp endpoint. claude.ai's web client probes the server from
// the https://claude.ai browser origin, so WITHOUT these headers the browser's
// same-origin policy blocks the cross-origin request before the 401 OAuth
// challenge can be read — surfacing as "Couldn't connect to the server. Check
// that the URL points to a valid MCP server." at add-connector time, with no
// OAuth ever started. The discovery (.well-known) responses already carry CORS
// (better-auth's metadata helper adds it); the endpoint itself did not.
//
// `WWW-Authenticate` MUST be in Expose-Headers or the browser can read the
// challenge's status but not the header that points at the auth server. The
// Mcp-* headers cover the Streamable-HTTP transport's session/version headers.
// Allow-Origin `*` is safe here: the connector authenticates with a Bearer
// token (a header), never cookies, so no credentialed-CORS constraint applies —
// same posture as the `*` on the discovery routes.
const MCP_CORS_BASE: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
};

const MCP_CORS_PREFLIGHT: Readonly<Record<string, string>> = {
  ...MCP_CORS_BASE,
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

// Add CORS headers to any MCP endpoint response (including the 401 challenge and
// the self-host 404). Re-wraps so the header set survives — same pattern as
// withScopeChallenge; the body stream is transferred, not consumed.
export function withMcpCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(MCP_CORS_BASE)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

// The OPTIONS preflight response: 204 + the full allow-methods/headers set.
export function mcpCorsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...MCP_CORS_PREFLIGHT } });
}
