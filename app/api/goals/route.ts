import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();

  const goals = await repo.goals.list();
  const progress = await repo.goals.currentProgress();
  const categories = await repo.transactions.categories();
  const averages = await repo.goals.categoryAverages();

  return Response.json({ goals, progress, categories, averages });
}

export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();
  const body = await request.json();

  const limit = Number(body.monthly_limit);
  if (!body.category || !Number.isFinite(limit) || limit <= 0) {
    return Response.json(
      { error: "category and a positive monthly_limit required" },
      { status: 400 }
    );
  }

  await repo.goals.upsert(body.category, limit);
  return Response.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  await repo.goals.delete(parseInt(id));
  return Response.json({ success: true });
}
