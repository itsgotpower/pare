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

  if (body.action === "recategorize_all") {
    const changed = await repo.categories.recategorizeAll();
    return Response.json({ success: true, changed });
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
