import { isHostedMode } from "@/lib/auth/resolve";

// Web Push subscription management (installed PWA). Self-host/Node only for
// now: the sender (lib/push/webpush.ts) needs node:fs + the `web-push`
// package, neither of which run on Workers. Hosted push (per-user
// subscriptions in the DO + a WebCrypto VAPID sender in the queue consumer)
// is a follow-up — until then hosted callers get a clean 501.
//
// GET             → { publicKey } (VAPID applicationServerKey for subscribe())
// POST { subscription }           → store it; sends a confirmation push
// DELETE { endpoint }             → remove it
const HOSTED_501 = () =>
  Response.json({ error: "Push is not available on hosted yet." }, { status: 501 });

export async function GET() {
  if (isHostedMode()) return HOSTED_501();
  const { getVapidKeys } = await import("@/lib/push/webpush");
  return Response.json({ publicKey: getVapidKeys().publicKey });
}

export async function POST(request: Request) {
  if (isHostedMode()) return HOSTED_501();
  let sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    sub = (await request.json())?.subscription ?? {};
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return Response.json({ error: "Invalid subscription." }, { status: 400 });
  }

  const { savePushSubscription } = await import("@/lib/db/push");
  savePushSubscription({
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  });

  // Confirmation doubles as the end-to-end test of the whole pipeline.
  const { sendPushToAll } = await import("@/lib/push/webpush");
  await sendPushToAll({
    title: "pare",
    body: "Notifications on — you'll hear when a statement finishes parsing.",
    url: "/upload",
  });

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (isHostedMode()) return HOSTED_501();
  let endpoint = "";
  try {
    endpoint = (await request.json())?.endpoint ?? "";
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!endpoint) return Response.json({ error: "Missing endpoint." }, { status: 400 });

  const { deletePushSubscription } = await import("@/lib/db/push");
  deletePushSubscription(endpoint);
  return Response.json({ ok: true });
}
