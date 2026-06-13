import { NextRequest } from "next/server";
import { getRepo } from "@/lib/repo";

export async function GET(request: NextRequest) {
  const repo = getRepo();
  await repo.categories.seed();

  const params = request.nextUrl.searchParams;

  const filters = {
    category: params.get("category") || undefined,
    source: params.get("source") || undefined,
    flow: params.get("flow") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    search: params.get("search") || undefined,
    page: params.get("page") ? parseInt(params.get("page")!) : 1,
    limit: params.get("limit") ? parseInt(params.get("limit")!) : 50,
  };

  const { rows, total } = await repo.transactions.list(filters);
  const categories = await repo.transactions.categories();

  return Response.json({ rows, total, categories });
}
