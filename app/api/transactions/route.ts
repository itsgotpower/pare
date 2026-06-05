import { NextRequest } from "next/server";
import { listTransactions, getCategories } from "@/lib/db/transactions";
import { seedCategoryRules } from "@/lib/db/categories";

export async function GET(request: NextRequest) {
  seedCategoryRules();

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

  const { rows, total } = listTransactions(filters);
  const categories = getCategories();

  return Response.json({ rows, total, categories });
}
