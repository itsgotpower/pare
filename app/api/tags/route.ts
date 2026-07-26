import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// Tags + reimbursement tracking (lib/db/tags.ts).
//
// GET                      → { tags: [{tag, count}], reimbursements: summary }
//                            (the filter dropdown + the OUTSTANDING strip)
// GET ?transaction_id=N    → { tags: string[] } (one row's tags, for the dialog)
// POST { action, ... }     → set_tags { transaction_id, tags } → { tags }
//                            mark_reimbursable / mark_reimbursed /
//                            clear_reimbursement { transaction_id } → { ok }
//
// Same contract as the splits route: unknown transaction → 404, every other
// lib-layer rejection → 400 with its user-safe message.

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const rawId = request.nextUrl.searchParams.get("transaction_id");
  if (rawId !== null) {
    const id = parseId(rawId);
    if (!id) {
      return Response.json({ error: "transaction_id must be a positive integer" }, { status: 400 });
    }
    return Response.json({ tags: await repo.tags.list(id) });
  }

  const [tags, reimbursements] = await Promise.all([
    repo.tags.counts(),
    repo.tags.reimbursementSummary(),
  ]);
  return Response.json({ tags, reimbursements });
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    transaction_id?: unknown;
    tags?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const id = parseId(body.transaction_id);
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }

  // 404 for a missing row (same contract as the splits/override routes);
  // everything else the lib layer rejects is a 400 with its message.
  const tx = await repo.transactions.categoryOf(id);
  if (!tx) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  try {
    switch (body.action) {
      case "set_tags": {
        if (!Array.isArray(body.tags)) {
          return Response.json({ error: "tags must be an array" }, { status: 400 });
        }
        const tags = await repo.tags.set(id, body.tags as string[]);
        return Response.json({ tags });
      }
      case "mark_reimbursable":
        await repo.tags.markReimbursable(id);
        return Response.json({ ok: true });
      case "mark_reimbursed":
        await repo.tags.markReimbursed(id);
        return Response.json({ ok: true });
      case "clear_reimbursement":
        await repo.tags.clearReimbursement(id);
        return Response.json({ ok: true });
      default:
        return Response.json(
          {
            error:
              "action must be set_tags, mark_reimbursable, mark_reimbursed, or clear_reimbursement",
          },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save the change";
    return Response.json({ error: message }, { status: 400 });
  }
}
