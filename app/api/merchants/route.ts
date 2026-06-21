import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

// GET /api/merchants            -> the merchant index (biggest card spend first)
// GET /api/merchants?merchant=X -> one merchant's full history (404 if no match)
export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();

  const slug = request.nextUrl.searchParams.get("merchant");

  if (slug) {
    const detail = await repo.merchants.detail(slug);
    if (!detail) return Response.json({ error: "Merchant not found" }, { status: 404 });
    return Response.json(detail);
  }

  return Response.json({ merchants: await repo.merchants.list() });
}
