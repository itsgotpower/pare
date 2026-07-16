import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// Keep in sync with BULK_ASSIGN_MAX in lib/db/categories.ts (the lib layer
// enforces it too; this check just fails fast with a 400).
const BULK_MAX = 500;

// Single override ({transaction_id, new_category} → {success}) or bulk
// ({transaction_ids: number[], new_category} → {updated, skipped}). Bulk goes
// through repo.categories.bulkOverride — ONE repo call (one DO round trip on
// hosted), split rows skipped server-side.
export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const body = await request.json();
  const newCategory = typeof body.new_category === "string" ? body.new_category.trim() : "";

  if (Array.isArray(body.transaction_ids)) {
    const ids = (body.transaction_ids as unknown[]).map(Number);
    if (!ids.length || ids.some((id) => !Number.isInteger(id)) || !newCategory) {
      return Response.json(
        { error: "transaction_ids (integers) and new_category required" },
        { status: 400 }
      );
    }
    if (ids.length > BULK_MAX) {
      return Response.json(
        { error: `Too many transactions in one bulk update (max ${BULK_MAX})` },
        { status: 400 }
      );
    }
    const { updated, skipped } = await repo.categories.bulkOverride(ids, newCategory);
    return Response.json({ updated, skipped });
  }

  const transactionId = Number(body.transaction_id);

  if (!Number.isInteger(transactionId) || !newCategory) {
    return Response.json(
      { error: "transaction_id and new_category required" },
      { status: 400 }
    );
  }

  const tx = await repo.transactions.categoryOf(transactionId);
  if (!tx) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  await repo.categories.addOverride(transactionId, tx.category, newCategory);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const id = request.nextUrl.searchParams.get("transaction_id");
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }

  await repo.categories.removeOverride(parseInt(id));
  return Response.json({ success: true });
}
