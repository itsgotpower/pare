import { NextRequest } from "next/server";
import { getScopedRepo, unauthorized } from "@/lib/repo/scoped";

export async function GET(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();
  await repo.categories.seed();
  return Response.json(await repo.subscriptions.get());
}

// Mark / unmark a subscription for cancellation (the /recurring "cancel list").
export async function POST(request: NextRequest) {
  const repo = await getScopedRepo(request);
  if (!repo) return unauthorized();

  let body: {
    action?: string;
    slug?: string;
    merchant?: string;
    monthlyCost?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.slug || typeof body.slug !== "string") {
    return Response.json({ error: "slug required" }, { status: 400 });
  }

  if (body.action === "mark") {
    if (!body.merchant || typeof body.monthlyCost !== "number") {
      return Response.json(
        { error: "merchant and monthlyCost required" },
        { status: 400 }
      );
    }
    await repo.subscriptions.mark(body.slug, body.merchant, body.monthlyCost);
    return Response.json({ ok: true });
  }

  if (body.action === "unmark") {
    await repo.subscriptions.unmark(body.slug);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
