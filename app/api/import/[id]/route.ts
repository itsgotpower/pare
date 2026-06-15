import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// DELETE /api/import/:id — one-click undo of a migration. Removes every
// transaction tagged with this import_id, then the imports row (FK-safe order is
// handled in repo.imports.delete). PDF-parsed rows (import_id NULL) are
// untouched. Note: PDF rows the overlap guard SKIPPED during ingestion were never
// inserted, so after an undo, re-uploading those PDFs backfills the seam.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  const { id } = await params;
  const importId = Number(id);
  if (!Number.isInteger(importId) || importId <= 0) {
    return Response.json({ error: "Invalid import id" }, { status: 400 });
  }

  const { deleted } = await repo.imports.delete(importId);
  return Response.json({ deleted });
}
