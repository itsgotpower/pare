// getScopedRepo — the one helper every API route uses to get the CALLER's Repo.
//
//   const repo = await getScopedRepo(request);
//   if (!repo) return unauthorized();   // hosted mode, no/invalid credential
//
// It folds together the two halves Sessions 3 and 6 built:
//   1. resolveUser(request, hostedAuth) -> who is calling (cookie or bearer)
//   2. the right Repo for that caller:
//        - hosted      -> getRepoForUser(userId): that user's Durable Object.
//                         No credential -> null, so the route returns 401.
//        - self-hosted -> the process-wide file-backed Repo. The single-user
//                         proxy gate still fronts the routes (unchanged), and
//                         there is exactly one account, so there is nothing to
//                         scope; return getRepo() directly. This keeps local dev
//                         and the MCP server byte-for-byte identical.
//
// The hosted path needs the request-scoped better-auth instance (the D1 binding
// only exists inside the Worker request). We build it lazily from getD1() so the
// import graph stays clean in Node/dev.

import { getRepo, getRepoForUser } from "./index";
import { resolveUser, isHostedMode } from "../auth/resolve";
import type { Repo } from "./types";

// A fixed, well-known DO id for tenant-LESS data (the marketing waitlist), which
// is posted while signed out and so has no user to scope to. In hosted mode it
// lives in its own shared DO; in self-hosted it's just the file repo.
const SHARED_DO_USER = "__shared__waitlist";

export async function getScopedRepo(request: Request): Promise<Repo | null> {
  if (!isHostedMode()) {
    // Self-hosted/local: proxy.ts still gates the route; one account, file-backed.
    return getRepo();
  }

  // Hosted: build the request-scoped auth (D1 binding) and resolve the caller.
  const { createHostedAuth } = await import("../auth/hosted");
  const { getD1 } = await import("../auth/d1");
  const auth = createHostedAuth(await getD1());

  const resolved = await resolveUser(request, auth);
  if (!resolved) return null; // -> route returns 401

  return getRepoForUser(resolved.userId);
}

// Repo for tenant-less, public data (the waitlist signup, posted signed-out).
// Hosted: a single shared DO; self-hosted: the file repo. Never per-user.
export async function getSharedRepo(): Promise<Repo> {
  if (!isHostedMode()) return getRepo();
  return getRepoForUser(SHARED_DO_USER);
}

// Convenience 401 the routes return when getScopedRepo yields null.
export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
