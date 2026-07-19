import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withScopeChallenge,
  withMcpCors,
  mcpCorsPreflight,
  isMcpOAuthPath,
  MCP_SCOPE,
} from "./mcp-challenge";

test("withScopeChallenge appends scope to a 401 challenge", () => {
  const res = new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' },
  });
  const out = withScopeChallenge(res);
  assert.match(out.headers.get("www-authenticate") ?? "", new RegExp(`scope="${MCP_SCOPE}"`));
});

test("withScopeChallenge leaves non-401 and already-scoped responses untouched", () => {
  const ok = new Response(null, { status: 200 });
  assert.equal(withScopeChallenge(ok), ok);

  const scoped = new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Bearer resource_metadata="x", scope="offline_access"' },
  });
  assert.equal(withScopeChallenge(scoped), scoped);
});

test("withMcpCors adds Allow-Origin + exposes WWW-Authenticate, preserving status", () => {
  const res = new Response('{"jsonrpc":"2.0"}', {
    status: 401,
    headers: { "www-authenticate": "Bearer", "content-type": "application/json" },
  });
  const out = withMcpCors(res);
  assert.equal(out.status, 401);
  assert.equal(out.headers.get("access-control-allow-origin"), "*");
  assert.equal(out.headers.get("content-type"), "application/json"); // existing headers survive
  const expose = out.headers.get("access-control-expose-headers") ?? "";
  assert.ok(expose.includes("WWW-Authenticate"), "WWW-Authenticate must be exposed cross-origin");
});

test("withMcpCors preserves the body", async () => {
  const out = withMcpCors(new Response("hello", { status: 200 }));
  assert.equal(await out.text(), "hello");
});

test("mcpCorsPreflight is a 204 advertising the MCP methods + headers", () => {
  const res = mcpCorsPreflight();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const methods = res.headers.get("access-control-allow-methods") ?? "";
  for (const m of ["GET", "POST", "DELETE", "OPTIONS"]) assert.ok(methods.includes(m), `preflight allows ${m}`);
  const allowed = res.headers.get("access-control-allow-headers") ?? "";
  assert.ok(allowed.includes("Authorization"), "preflight must allow the Authorization header");
  assert.ok(res.headers.get("access-control-max-age"), "preflight should cache");
});

test("isMcpOAuthPath matches the discovery + MCP OAuth sub-paths", () => {
  // The browser-side connector chain that needs cross-origin CORS.
  for (const p of [
    "/api/auth/.well-known/oauth-protected-resource",
    "/api/auth/.well-known/oauth-authorization-server",
    "/api/auth/mcp/register",
    "/api/auth/mcp/token",
    "/api/auth/mcp/jwks",
  ]) {
    assert.ok(isMcpOAuthPath(p), `${p} must be treated as an MCP OAuth path`);
  }
});

test("isMcpOAuthPath does NOT match the same-origin auth surface", () => {
  // sign-in/up/reset must stay CORS-free (no Allow-Origin: *).
  for (const p of [
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
    "/api/auth/get-session",
  ]) {
    assert.equal(isMcpOAuthPath(p), false, `${p} must NOT be treated as an MCP OAuth path`);
  }
});
