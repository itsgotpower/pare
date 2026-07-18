import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();

  const rules = await repo.categories.listRules();
  const uncategorizedCount = await repo.categories.uncategorizedCount();
  const suggestions = await repo.categories.ruleSuggestions();

  return Response.json({ rules, uncategorized_count: uncategorizedCount, suggestions });
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();
  const body = await request.json();

  if (body.action === "dismiss_suggestion") {
    if (typeof body.keyword !== "string" || typeof body.category !== "string") {
      return Response.json({ error: "keyword and category required" }, { status: 400 });
    }
    await repo.categories.dismissSuggestion(body.keyword, body.category);
    return Response.json({ success: true });
  }

  if (body.action === "recategorize_all") {
    const changed = await repo.categories.recategorizeAll();
    return Response.json({ success: true, changed });
  }

  if (body.action === "import_rules") {
    // Accept either a bare rules array or a full /api/data JSON export (which
    // nests the rules under `category_rules`).
    const raw = Array.isArray(body.rules)
      ? body.rules
      : Array.isArray(body.category_rules)
        ? body.category_rules
        : null;
    if (!raw) {
      return Response.json(
        { error: "rules (or category_rules) array required" },
        { status: 400 }
      );
    }
    const rules = raw
      .filter((r: unknown): r is { category: string; keyword: string } => {
        const o = r as { category?: unknown; keyword?: unknown };
        return typeof o?.category === "string" && typeof o?.keyword === "string";
      })
      .map((r: { category: string; keyword: string }) => ({
        category: r.category,
        keyword: r.keyword,
      }));

    const result = await repo.categories.importRules(rules);
    const changed = await repo.categories.recategorizeAll();
    return Response.json({ success: true, ...result, recategorized: changed });
  }

  if (!body.category || !body.keyword) {
    return Response.json({ error: "category and keyword required" }, { status: 400 });
  }

  try {
    await repo.categories.addRule(body.category, body.keyword);

    let changed = 0;
    if (body.apply_existing) {
      changed = await repo.categories.recategorizeMatching(body.keyword, body.category);
    }

    return Response.json({ success: true, changed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add rule";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  await repo.categories.deleteRule(parseInt(id));
  return Response.json({ success: true });
}
