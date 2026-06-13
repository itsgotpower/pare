import { NextRequest } from "next/server";
import { getRepo } from "@/lib/repo";

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

  const repo = getRepo();
  const tx = await repo.transactions.categoryOf(transactionId);
  if (!tx) {
    return Response.json({ error: "transaction not found" }, { status: 404 });
  }

  await repo.categories.addOverride(transactionId, tx.category, newCategory);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("transaction_id");
  if (!id) {
    return Response.json({ error: "transaction_id required" }, { status: 400 });
  }

  await getRepo().categories.removeOverride(parseInt(id));
  return Response.json({ success: true });
}
