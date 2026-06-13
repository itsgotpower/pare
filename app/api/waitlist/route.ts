import { NextRequest } from "next/server";
import { joinWaitlist } from "@/lib/db/waitlist";

// Public endpoint (allowlisted in proxy.ts) — the marketing homepage posts here
// while the visitor is signed out.
export async function POST(request: NextRequest) {
  let email = "";
  try {
    const body = await request.json();
    email = typeof body?.email === "string" ? body.email : "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = joinWaitlist(email);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ success: true, alreadyJoined: result.alreadyJoined });
}
