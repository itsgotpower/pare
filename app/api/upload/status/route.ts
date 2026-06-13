import { NextRequest } from "next/server";
import { getJobStore } from "@/lib/queue/job-store";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import { unauthorized } from "@/lib/repo/scoped";

// ===========================================================================
// GET /api/upload/status?jobId=<id> — poll a hosted parse job. [Mobile app only]
//
//   GET /api/upload/status?jobId=<jobId>
//   Authorization: Bearer <better-auth session token>   (OR the session cookie)
//
//   Returns the job record (200) or 404 if no such job exists FOR THE CALLER.
//
//   Record shape (lib/queue/job-store.ts ParseJobRecord):
//     { jobId, userId, filename, status, inserted, skipped, error,
//       createdAt, updatedAt }
//   where status is "queued" | "parsing" | "done" | "failed".
//   On "done", { inserted, skipped } are set; on "failed", { error } is set.
//
// TENANCY — the job-store key is `job/<userId>/<jobId>`, so the lookup is scoped
// to the AUTHENTICATED caller: we pass `resolved.userId` (never a userId from the
// query/body) to jobStore.get(userId, jobId). A caller asking for a jobId they
// don't own simply addresses a non-existent key and gets 404 — user A can never
// read user B's job.
//
// HOSTED-ONLY: the async job pipeline (R2/Queue/KV) doesn't exist in self-host
// mode (uploads parse inline and return their result synchronously), so this
// endpoint is 404 there.
// ===========================================================================

export async function GET(request: NextRequest) {
  if (!isHostedMode()) {
    // No async jobs in self-host mode — nothing to look up.
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Authenticate the caller (cookie OR bearer) via the request-scoped auth.
    const { createHostedAuth } = await import("@/lib/auth/hosted");
    const { getD1 } = await import("@/lib/auth/d1");
    const auth = createHostedAuth(await getD1());
    const resolved = await resolveUser(request, auth);
    if (!resolved) return unauthorized();

    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) {
      return Response.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Scope strictly to the authed user: pass resolved.userId, NOT any id from
    // the request. A foreign jobId resolves to a non-existent key -> null -> 404.
    const jobStore = await getJobStore();
    const job = await jobStore.get(resolved.userId, jobId);
    if (!job) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status lookup failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
