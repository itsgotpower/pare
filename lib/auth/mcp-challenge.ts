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
