import { NextRequest } from "next/server";
import { getRepo } from "@/lib/repo";
import { getDb } from "@/lib/db";

export async function GET() {
  const repo = getRepo();
  await repo.categories.seed();

  const goals = await repo.goals.list();
  const progress = await repo.goals.currentProgress();
  const categories = await repo.transactions.categories();

  // Route-local aggregate (suggested limits from 6-mo averages) — not part of the
  // Repo surface; runs on the same connection the Repo opened above. Fold into the
  // Repo when the encrypted/DO backend lands (Phase 2-3).
  const db = getDb();
  const averages = db
    .prepare(
      `SELECT effective_category AS category,
              AVG(monthly_total) AS avg_monthly
       FROM (
         SELECT effective_category, substr(txn_date, 1, 7) AS month, SUM(amount) AS monthly_total
         FROM v_transactions
         WHERE flow = 'spend' AND source IN ('amex', 'cibc_visa')
         GROUP BY effective_category, month
       )
       GROUP BY category
       ORDER BY avg_monthly DESC`
    )
    .all() as { category: string; avg_monthly: number }[];

  return Response.json({ goals, progress, categories, averages });
}

export async function POST(request: NextRequest) {
  const repo = getRepo();
  await repo.categories.seed();
  const body = await request.json();

  if (!body.category || !body.monthly_limit) {
    return Response.json({ error: "category and monthly_limit required" }, { status: 400 });
  }

  await repo.goals.upsert(body.category, body.monthly_limit);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  await getRepo().goals.delete(parseInt(id));
  return Response.json({ success: true });
}
