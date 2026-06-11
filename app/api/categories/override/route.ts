import { NextRequest } from "next/server";
import { addOverride, removeOverride } from "@/lib/db/categories";
import { getDb } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const transactionId = Number(body.transaction_id);
  const newCategory = typeof body.new_category === "string" ? body.new_category.trim() : "";

  if (!Number.isInteger(transactionId) || !newCategory) {
    return Response.json(
      { error: "transaction_id and new_category required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const tx = db
    .prepare("SELECT category FROM transactions WHERE id = ?")
    .get(transactionId) as { category: string } | undefined;
  if (!tx) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  addOverride(transactionId, tx.category, newCategory);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("transaction_id");
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }

  removeOverride(parseInt(id));
  return Response.json({ success: true });
}
