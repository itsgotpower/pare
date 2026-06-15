import { NextRequest } from "next/server";

// POST /api/billing/webhook — Stripe webhook receiver.
//
// Thin shim over cloud/billing/webhook.ts. NO auth gate here: Stripe
// authenticates the request with a signature header, which the handler verifies
// (WebCrypto, async) — that IS the authentication. In hosted mode the Edge
// middleware retires the session gate entirely (middleware.ts: `if (HOSTED)
// return NextResponse.next()`), so this route is reachable without a session and
// without being listed in PUBLIC_PATHS.
//
// The handler reads the RAW request body for signature verification, so this
// shim forwards the Request untouched — do not parse it first.

export async function POST(request: NextRequest) {
  const { handleStripeWebhook } = await import("@/cloud/billing/webhook");
  return handleStripeWebhook(request);
}
