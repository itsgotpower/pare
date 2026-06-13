import { getRepo } from "@/lib/repo";

export async function GET() {
  const repo = getRepo();
  await repo.categories.seed();
  return Response.json(await repo.subscriptions.get());
}
