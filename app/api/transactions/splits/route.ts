import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// Split one spend transaction into >= 2 category parts (lib/db/splits.ts).
// GET ?transaction_id → { parts }; POST { transaction_id, parts } → { ok };
// DELETE ?transaction_id → clear (the row reverts to its base/override
// category). Validation failures surface as 400 with the lib layer's
// user-safe message; an unknown transaction is a 404.

function parseId(raw: string | null): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const id = parseId(request.nextUrl.searchParams.get("transaction_id"));
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }
  const parts = await repo.splits.list(id);
  return Response.json({ parts });
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    transaction_id?: unknown;
    parts?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const id = Number(body.transaction_id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }
  if (!Array.isArray(body.parts)) {
    return Response.json({ error: "parts must be an array" }, { status: 400 });
  }
  const parts = (body.parts as { category?: unknown; amount?: unknown }[]).map((p) => ({
    category: typeof p?.category === "string" ? p.category : "",
    amount: typeof p?.amount === "number" ? p.amount : NaN,
  }));

  // 404 for a missing row (same contract as the override route); everything
  // else the lib layer rejects is a 400 with its message.
  const tx = await repo.transactions.categoryOf(id);
  if (!tx) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  try {
    await repo.splits.set(id, parts);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save the split";
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const id = parseId(request.nextUrl.searchParams.get("transaction_id"));
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }
  await repo.splits.clear(id);
  return Response.json({ ok: true });
}
