import { NextRequest } from "next/server";
import { listGoals, upsertGoal, deleteGoal, getCurrentProgress } from "@/lib/db/goals";
import { getCategories } from "@/lib/db/transactions";
import { seedCategoryRules } from "@/lib/db/categories";
import { getDb } from "@/lib/db";

export async function GET() {
  seedCategoryRules();

  const goals = listGoals();
  const progress = getCurrentProgress();
  const categories = getCategories();

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
  seedCategoryRules();
  const body = await request.json();

  if (!body.category || !body.monthly_limit) {
    return Response.json({ error: "category and monthly_limit required" }, { status: 400 });
  }

  upsertGoal(body.category, body.monthly_limit);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  deleteGoal(parseInt(id));
  return Response.json({ success: true });
}
