import { isHostedMode } from "@/lib/auth/resolve";

// Forced-consent shim in front of the better-auth MCP authorize endpoint.
//
// The mcp plugin's /api/auth/mcp/authorize only shows a consent step when the
// CLIENT sends `prompt=consent` (see node_modules better-auth plugins/mcp/
// authorize.mjs — unlike the oidc-provider authorize, it never checks prior
// consent), and the server has no option to require it. Silent grants are not
// acceptable for financial data, so our discovery document advertises THIS
// route as the authorization_endpoint (app/.well-known/oauth-authorization-
// server rewrites the field); it forces `prompt=consent` onto every authorize
// request and forwards to the real endpoint. The consent UI itself is
// /oauth/consent (oidcConfig.consentPage in lib/auth/hosted.ts).
// Spec: internal/remote-mcp-spec.md (finding #2).

export async function GET(request: Request): Promise<Response> {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  const target = new URL("/api/auth/mcp/authorize", url.origin);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const prompt = new Set((target.searchParams.get("prompt") ?? "").split(" ").filter(Boolean));
  prompt.add("consent");
  target.searchParams.set("prompt", Array.from(prompt).join(" "));
  return Response.redirect(target.toString(), 302);
}
