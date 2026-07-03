import { getDb } from "../db";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function savePushSubscription(sub: PushSubscriptionRow): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, sub.p256dh, sub.auth);
}

export function deletePushSubscription(endpoint: string): void {
  getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function listPushSubscriptions(): PushSubscriptionRow[] {
  return getDb()
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions")
    .all() as PushSubscriptionRow[];
}
