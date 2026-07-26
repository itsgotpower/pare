import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// Statement management (the STATEMENTS card on /profile): list every statement
// record, and delete one together with all of its transactions (plus their
// overrides and splits — see lib/db/statements.ts deleteStatement). GET also
// returns the accounts list so the client can label each source exactly the
// way DATA HEALTH does (nickname if set, else the derived source label) —
// reusing repo.accounts.list() instead of re-deriving labels client-side.

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  return Response.json({
    statements: await repo.statements.list(),
    accounts: await repo.accounts.list(),
  });
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "number" ? body.id : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const result = await repo.statements.deleteById(id);
  if (!result.deleted) {
    return Response.json({ error: "Unknown statement" }, { status: 404 });
  }
  // { deleted: 1, transactions: N } — how many rows went with the statement.
  return Response.json(result);
}
