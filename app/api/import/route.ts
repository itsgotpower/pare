import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { analyzeCsv } from "@/lib/import/preview";
import { PROVIDERS, type Provider } from "@/lib/import/presets";
import { CATEGORY_COLORS } from "@/lib/colors";

// POST /api/import — PREVIEW step (no writes). Accepts a multipart CSV (+ an
// optional `provider` override when auto-detection can't ID the file) and
// returns the proposed account/category mappings + a sample for the wizard's Map
// & Review steps. The client edits the mappings and posts them to
// /api/import/commit, which RE-parses the raw CSV server-side (never trusts
// client rows). Gated like every data route — must be signed in.

const MAX_CSV_BYTES = 15 * 1024 * 1024; // exports are text; 15 MB clears any real file

// The category dropdown's canonical options: the shipped taxonomy (colour keys
// are the canonical category NAMES) plus any categories already in the user's DB.
function categoryOptions(existing: string[]): string[] {
  return [...new Set([...Object.keys(CATEGORY_COLORS), ...existing])].sort();
}

// GET /api/import — list past imports (for the wizard's "previous imports" /
// undo list).
export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const imports = await repo.imports.list();
  return Response.json({ imports });
}

export async function POST(request: NextRequest) {
  try {
    const repo = await getScopedRepo(request);
    if (!repo) return unauthorized();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const providerRaw = (formData.get("provider") as string | null)?.trim() || undefined;

    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
    if (file.size > MAX_CSV_BYTES) {
      return Response.json({ error: "CSV too large (max 15 MB)." }, { status: 400 });
    }
    const provider =
      providerRaw && (PROVIDERS as string[]).includes(providerRaw)
        ? (providerRaw as Provider)
        : undefined;

    const text = await file.text();
    const result = analyzeCsv(text, provider);

    if (!result.ok) {
      if (result.error === "no_rows") {
        return Response.json({ error: "No rows found in the CSV." }, { status: 400 });
      }
      // Couldn't auto-detect the provider — ask the client to pick one.
      return Response.json(
        {
          error: "unknown_provider",
          message: "Couldn't recognize this export. Pick the source app.",
          headers: result.headers,
          providers: PROVIDERS,
        },
        { status: 422 }
      );
    }

    const existing = await repo.transactions.categories();
    return Response.json({
      ...result.preview,
      categoryOptions: categoryOptions(existing),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
