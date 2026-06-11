import { NextRequest } from "next/server";
import { listRules, addRule, deleteRule, seedCategoryRules, recategorizeAll, recategorizeMatching } from "@/lib/db/categories";
import { getDb } from "@/lib/db";

export async function GET() {
  seedCategoryRules();
  const rules = listRules();

  const db = getDb();
  const uncategorized = db
    .prepare(
      `SELECT COUNT(*) as count FROM v_transactions
       WHERE effective_category = 'Other / uncategorized' AND flow = 'spend'`
    )
    .get() as { count: number };

  const suggestions = getSuggestions();

  return Response.json({ rules, uncategorized_count: uncategorized.count, suggestions });
}

export async function POST(request: NextRequest) {
  seedCategoryRules();
  const body = await request.json();

  if (body.action === "recategorize_all") {
    const changed = recategorizeAll();
    return Response.json({ success: true, changed });
  }

  if (!body.category || !body.keyword) {
    return Response.json({ error: "category and keyword required" }, { status: 400 });
  }

  try {
    addRule(body.category, body.keyword);

    let changed = 0;
    if (body.apply_existing) {
      changed = recategorizeMatching(body.keyword, body.category);
    }

    return Response.json({ success: true, changed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add rule";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  deleteRule(parseInt(id));
  return Response.json({ success: true });
}

function getSuggestions(): { keyword: string; category: string; count: number }[] {
  const db = getDb();
  const overrides = db
    .prepare(
      `SELECT co.new_category, t.description
       FROM category_overrides co
       JOIN transactions t ON t.id = co.transaction_id`
    )
    .all() as { new_category: string; description: string }[];

  if (overrides.length < 2) return [];

  const byCategory = new Map<string, string[]>();
  for (const o of overrides) {
    const descs = byCategory.get(o.new_category) || [];
    descs.push(o.description.toUpperCase());
    byCategory.set(o.new_category, descs);
  }

  const suggestions: { keyword: string; category: string; count: number }[] = [];

  for (const [category, descriptions] of byCategory) {
    if (descriptions.length < 2) continue;

    const common = longestCommonSubstring(descriptions);
    if (common.length < 3) continue;

    const matchCount = (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM transactions
           WHERE UPPER(description) LIKE '%' || ? || '%'
             AND category != ?`
        )
        .get(common, category) as { count: number }
    ).count;

    if (matchCount > 0) {
      suggestions.push({ keyword: common, category, count: matchCount });
    }
  }

  return suggestions;
}

function longestCommonSubstring(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  let best = "";
  const first = strings[0];

  for (let i = 0; i < first.length; i++) {
    for (let len = first.length - i; len > best.length; len--) {
      const candidate = first.substring(i, i + len).trim();
      if (candidate.length <= best.length) continue;
      if (strings.every((s) => s.includes(candidate))) {
        best = candidate;
      }
    }
  }

  return best;
}
