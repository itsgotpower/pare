import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";
import { parseCsv } from "@/lib/import/csv";
import { PRESETS, PROVIDERS, type Provider } from "@/lib/import/presets";
import { normalizeAll, type AccountMapping } from "@/lib/import/normalizer";
import { insertImportedRows } from "@/lib/repo/insert-imported";

// POST /api/import/commit — APPLY step. Re-parses the raw CSV from the request
// (NEVER trusts client-supplied rows — same trust boundary as the upload route
// re-parsing the PDF), normalizes with the user's edited account/category maps,
// tags the rows with a new import_id, and writes them. Idempotent: the stable
// per-account source slug yields identical dedup_keys, so a re-submit skips.

interface CommitBody {
  provider: Provider;
  csv: string;
  accountMap: Record<string, AccountMapping>;
  categoryMap: Record<string, string>;
}

export async function POST(request: NextRequest) {
  try {
    const repo = await getScopedRepo(request);
    if (!repo) return unauthorized();

    const body = (await request.json()) as Partial<CommitBody>;
    const { provider, csv, accountMap, categoryMap } = body;

    if (!provider || !(PROVIDERS as string[]).includes(provider)) {
      return Response.json({ error: "Unknown or missing provider" }, { status: 400 });
    }
    if (typeof csv !== "string" || csv.trim().length === 0) {
      return Response.json({ error: "Missing CSV data" }, { status: 400 });
    }

    const preset = PRESETS[provider];
    const parsed = parseCsv(csv);
    const { rows, dropped } = normalizeAll(parsed.rows, parsed.headers, {
      preset,
      accountMap: accountMap ?? {},
      categoryMap: categoryMap ?? {},
    });

    if (rows.length === 0) {
      return Response.json(
        { error: "No importable rows after normalization.", dropped: dropped.length },
        { status: 400 }
      );
    }

    const { importId, inserted, skipped, watermarks } = await insertImportedRows(
      repo,
      provider,
      rows,
      accountMap ?? {}
    );

    return Response.json({
      importId,
      inserted,
      skipped,
      dropped: dropped.length,
      total: parsed.rows.length,
      watermarks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
