import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { isHostedMode } from "@/lib/auth/resolve";

// OAuth protected-resource metadata (RFC 9728) for the remote MCP connector:
// tells claude.ai which authorization server protects /api/mcp. Served by the
// better-auth mcp plugin; HOSTED-only for the same reasons as its sibling
// oauth-authorization-server route. Spec: internal/remote-mcp-spec.md.

export async function GET(request: Request): Promise<Response> {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const auth = createHostedAuth(await getD1());
  // Same erased-type cast as the sibling oauth-authorization-server route —
  // the mcp() plugin's endpoints exist at runtime but not on the erased type.
  return oAuthProtectedResourceMetadata(
    auth as unknown as Parameters<typeof oAuthProtectedResourceMetadata>[0]
  )(request);
}
