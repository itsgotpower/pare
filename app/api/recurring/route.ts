import { getSubscriptions } from "@/lib/db/subscriptions";
import { seedCategoryRules } from "@/lib/db/categories";

export async function GET() {
  seedCategoryRules();
  return Response.json(getSubscriptions());
}
