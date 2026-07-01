import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

function validateEntry(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return "name required";
  }
  if (body.kind !== "asset" && body.kind !== "liability") {
    return "kind must be 'asset' or 'liability'";
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return "amount must be a non-negative number";
  }
  if (typeof body.effective_date !== "string" || !DATE_RX.test(body.effective_date)) {
    return "effective_date must be YYYY-MM-DD";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  return Response.json(await repo.netWorth.get());
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const body = await request.json();
  const error = validateEntry(body);
  if (error) return Response.json({ error }, { status: 400 });

  await repo.netWorth.addEntry({
    name: (body.name as string).trim(),
    kind: body.kind,
    amount: Number(body.amount),
    effective_date: body.effective_date,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
  });
  return Response.json({ success: true });
}

export async function PUT(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const body = await request.json();
  const id = parseInt(String(body.id));
  if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });
  const error = validateEntry(body);
  if (error) return Response.json({ error }, { status: 400 });

  await repo.netWorth.updateEntry(id, {
    name: (body.name as string).trim(),
    kind: body.kind,
    amount: Number(body.amount),
    effective_date: body.effective_date,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
  });
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });

  await repo.netWorth.deleteEntry(id);
  return Response.json({ success: true });
}
