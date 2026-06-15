import { NextRequest } from "next/server";
import { isHostedMode, resolveUser } from "@/lib/auth/resolve";
import { createHostedAuth } from "@/lib/auth/hosted";
import { getD1 } from "@/lib/auth/d1";
import { deleteAccount } from "@/lib/account/delete";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/ratelimit";

// Account management. The substantive action here is DELETE — hosted-mode hard
// account deletion (DO + R2 + KV + D1 auth rows). See lib/account/delete.ts.
//
// Auth is per-request: DELETE resolves the CALLER via better-auth (cookie OR
// bearer, so the Expo app can self-serve deletion too — an App Store requirement)
// and only ever deletes that caller's own account. There is no admin "delete
// arbitrary user" path here.

// GET — lightweight mode probe for the profile UI: tells the client whether the
// "delete account" affordance applies (hosted only). No auth needed; returns no
// user data.
export async function GET() {
  return Response.json({ hosted: isHostedMode() });
}

export async function DELETE(request: NextRequest) {
  // Self-host has exactly one local account; "deleting" it means wiping the data
  // (POST-less: see /api/data DELETE) and removing the data/ dir — there's no
  // multi-tenant identity to tear down, and the R2/DO/D1 bindings don't exist.
  if (!isHostedMode()) {
    return Response.json(
      {
        error:
          "Account deletion is a hosted-mode action. In self-host, wipe via /api/data and remove your data/ directory.",
      },
      { status: 400 }
    );
  }

  // Throttle per IP — this orchestrates DO + R2 + KV + D1 work, so a caller must
  // not be able to hammer it (RL_AUTH, fails open when the binding is unwired).
  if (!(await allowRequest("RL_AUTH", clientIp(request)))) return tooManyRequests();

  // Explicit confirmation, matching the /api/data WIPE contract.
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "DELETE") {
    return Response.json(
      { error: 'Confirmation required: pass {"confirm":"DELETE"}' },
      { status: 400 }
    );
  }

  // Resolve the caller (cookie or bearer) via the request-scoped better-auth.
  const auth = createHostedAuth(await getD1());
  const resolved = await resolveUser(request, auth);
  if (!resolved) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteAccount(resolved.userId);

  // The session row is already deleted, so the cookie/bearer no longer resolves —
  // the client just redirects to the public landing. Report partial failures (the
  // operation is idempotent, so a 500 invites a safe retry).
  return Response.json(
    { success: result.ok, steps: result.steps, errors: result.errors },
    { status: result.ok ? 200 : 500 }
  );
}
