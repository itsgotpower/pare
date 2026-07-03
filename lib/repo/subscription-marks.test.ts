import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Subscription kill kit: price-hike detection (stable-before / stable-after),
// lapse detection against the DATA edge (not the wall clock), mark-to-cancel
// round-trip with charged-since-mark, and the lapsed exclusion from
// monthlyTotal. In-memory DoBackend for isolation (see manual-txns.test.ts).

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function charge(date: string, description: string, amount: number): NewTransaction {
  seq++;
  return {
    statement_id: null,
    source: "amex",
    account: "card",
    account_kind: "card",
    period: date.slice(0, 7),
    txn_date: date,
    description,
    amount,
    category: "Subscriptions",
    flow: "spend",
    dedup_key: `test|${seq}`,
  };
}

before(async () => {
  await backend.open();
  await repo.categories.seed();
  const rows: NewTransaction[] = [
    // STREAMFLIX: monthly, $15.99 for 4 charges then $19.99 twice — a hike.
    charge("2026-01-05", "STREAMFLIX.COM 1001", 15.99),
    charge("2026-02-05", "STREAMFLIX.COM 1002", 15.99),
    charge("2026-03-05", "STREAMFLIX.COM 1003", 15.99),
    charge("2026-04-05", "STREAMFLIX.COM 1004", 15.99),
    charge("2026-05-05", "STREAMFLIX.COM 1005", 19.99),
    charge("2026-06-05", "STREAMFLIX.COM 1006", 19.99),
    // GYMCO: monthly, stable, stops after March — lapsed by June's data edge.
    charge("2026-01-10", "GYMCO MEMBERSHIP", 45.0),
    charge("2026-02-10", "GYMCO MEMBERSHIP", 45.0),
    charge("2026-03-10", "GYMCO MEMBERSHIP", 45.0),
    // PODPLUS: monthly, stable, still active — the mark target.
    charge("2026-03-20", "PODPLUS AUDIO", 9.99),
    charge("2026-04-20", "PODPLUS AUDIO", 9.99),
    charge("2026-05-20", "PODPLUS AUDIO", 9.99),
    charge("2026-06-20", "PODPLUS AUDIO", 9.99),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);
});

test("price hike detected when both sides are stable", async () => {
  const { subscriptions } = await repo.subscriptions.get();
  const stream = subscriptions.find((s) => s.merchant.startsWith("STREAMFLIX"));
  assert.ok(stream, "STREAMFLIX should be detected as recurring");
  assert.ok(stream.priceChange, "price change should be detected");
  assert.equal(stream.priceChange.from, 15.99);
  assert.equal(stream.priceChange.to, 19.99);
  assert.equal(stream.priceChange.pct, 25);
  // The step explains the spread — not a variable-amount sub.
  assert.equal(stream.variableAmount, false);
  assert.equal(stream.lapsed, false);
});

test("lapsed when the data edge is >2× the cadence past the last charge", async () => {
  const { subscriptions, monthlyTotal } = await repo.subscriptions.get();
  const gym = subscriptions.find((s) => s.merchant.startsWith("GYMCO"));
  assert.ok(gym, "GYMCO should still be listed");
  assert.equal(gym.lapsed, true, "GYMCO should be lapsed (last charge Mar 10, edge Jun 20)");
  // Lapsed subs are excluded from the live monthly total.
  const active = subscriptions.filter((s) => !s.lapsed);
  const expected = active.reduce((t, s) => t + s.monthlyCost, 0);
  assert.ok(Math.abs(monthlyTotal - expected) < 1e-9);
});

test("mark → charged-since-mark accumulates; unmark clears", async () => {
  let { subscriptions } = await repo.subscriptions.get();
  const pod = subscriptions.find((s) => s.merchant.startsWith("PODPLUS"));
  assert.ok(pod);
  assert.equal(pod.markedAt, null);

  await repo.subscriptions.mark(pod.slug, pod.merchant, pod.monthlyCost);
  ({ subscriptions } = await repo.subscriptions.get());
  const marked = subscriptions.find((s) => s.slug === pod.slug)!;
  assert.ok(marked.markedAt, "mark should persist");
  assert.ok(Math.abs(marked.markedMonthlyCost - pod.monthlyCost) < 1e-9);
  // Marked today (after the last synthetic charge) — nothing charged since.
  assert.equal(marked.chargedSinceMark, 0);

  await repo.subscriptions.unmark(pod.slug);
  ({ subscriptions } = await repo.subscriptions.get());
  assert.equal(subscriptions.find((s) => s.slug === pod.slug)!.markedAt, null);
});

test("charges after the mark date count as charged-since-mark", async () => {
  const { subscriptions } = await repo.subscriptions.get();
  const pod = subscriptions.find((s) => s.merchant.startsWith("PODPLUS"))!;
  // Backdate a mark to before the last two charges via the write surface,
  // then verify the tally. markSubscription accepts markedAt server-side; the
  // repo surface always marks "today", so drive the db layer through a second
  // mark with an earlier date using the same upsert path.
  await repo.subscriptions.mark(pod.slug, pod.merchant, pod.monthlyCost);
  const db = await backend.open();
  db.prepare("UPDATE subscription_marks SET marked_at = '2026-04-30' WHERE slug = ?").run(pod.slug);

  const after = (await repo.subscriptions.get()).subscriptions.find(
    (s) => s.slug === pod.slug
  )!;
  // May 20 + Jun 20 charges landed after the (backdated) mark.
  assert.ok(Math.abs(after.chargedSinceMark - 19.98) < 1e-9);
  await repo.subscriptions.unmark(pod.slug);
});
