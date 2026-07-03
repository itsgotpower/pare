// Web Push sending for the Node/self-host runtime, via the `web-push` package
// (VAPID JWT + aes128gcm payload encryption). The hosted Cloudflare path can't
// use this module (node runtime only) — wiring push into the Workers queue
// consumer is a follow-up with a WebCrypto-based sender.
//
// VAPID keys resolve like the auth secret does (lib/auth/session.ts): env
// first (PARE_VAPID_PUBLIC_KEY / PARE_VAPID_PRIVATE_KEY), else a generated,
// gitignored data/vapid.json so local/self-host needs zero config.
import webpush from "web-push";
import fs from "node:fs";
import path from "node:path";
import {
  listPushSubscriptions,
  deletePushSubscription,
} from "@/lib/db/push";

const VAPID_SUBJECT = process.env.PARE_VAPID_SUBJECT ?? "mailto:hello@pare.money";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cached: VapidKeys | null = null;

export function getVapidKeys(): VapidKeys {
  if (cached) return cached;

  const envPub = process.env.PARE_VAPID_PUBLIC_KEY;
  const envPriv = process.env.PARE_VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    cached = { publicKey: envPub, privateKey: envPriv };
    return cached;
  }

  const file = path.join(process.cwd(), "data", "vapid.json");
  if (fs.existsSync(file)) {
    cached = JSON.parse(fs.readFileSync(file, "utf-8")) as VapidKeys;
    return cached;
  }

  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  cached = keys;
  return cached;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when the notification is tapped (default "/dashboard"). */
  url?: string;
}

// Send to every stored subscription. Fire-and-forget friendly: never throws,
// prunes subscriptions the push service reports as gone (404/410 = the user
// revoked permission or uninstalled the PWA).
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  const subs = listPushSubscriptions();
  if (subs.length === 0) return;

  const { publicKey, privateKey } = getVapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deletePushSubscription(s.endpoint);
        } else {
          console.error("[push] send failed:", status ?? err);
        }
      }
    })
  );
}
