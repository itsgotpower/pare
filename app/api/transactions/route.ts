import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();

  const params = request.nextUrl.searchParams;

  const filters = {
    category: params.get("category") || undefined,
    source: params.get("source") || undefined,
    flow: params.get("flow") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    search: params.get("search") || undefined,
    page: params.get("page") ? parseInt(params.get("page")!) : 1,
    limit: params.get("limit") ? parseInt(params.get("limit")!) : 50,
  };

  const { rows, total } = await repo.transactions.list(filters);
  const categories = await repo.transactions.categories();
  const sources = await repo.transactions.sources();

  return Response.json({ rows, total, categories, sources });
}

// Quick-add a manual cash transaction (source 'manual', account_kind 'cash').
export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const body = (await request.json().catch(() => null)) as {
    txn_date?: unknown;
    description?: unknown;
    amount?: unknown;
    category?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const txnDate = typeof body.txn_date === "string" ? body.txn_date : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const amount = typeof body.amount === "number" ? body.amount : NaN;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate) || Number.isNaN(Date.parse(txnDate))) {
    return Response.json({ error: "txn_date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!description) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!category) {
    return Response.json({ error: "category is required" }, { status: 400 });
  }

  const { id } = await repo.transactions.insertManual({
    txn_date: txnDate,
    description,
    // Cents precision — kills float dust before it hits the DB.
    amount: Math.round(amount * 100) / 100,
    category,
  });
  return Response.json({ id }, { status: 201 });
}

// Delete a quick-added transaction. Statement-backed rows are refused (404).
export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const id = parseInt(request.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const { deleted } = await repo.transactions.deleteManual(id);
  if (!deleted) {
    return Response.json(
      { error: "Only manually added transactions can be deleted" },
      { status: 404 }
    );
  }
  return Response.json({ deleted });
}
