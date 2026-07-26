import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Unusual one-off charge insights (insights.ts #5): merchant-relative outliers
// (>= 2.5× the merchant's prior median AND >= $50 over it, >= 3 prior charges),
// the category-relative fallback (mean + 2σ over the prior-6-month pool of >= 8
// charges AND >= $75), subscription exclusion, below-threshold and
// thin-history non-hits, and the top-3 cap. In-memory DoBackend for isolation
// (see manual-txns.test.ts).
//
// Fixture care: merchant-relative fixtures use VARIED prior amounts — a stable
// monthly amount would be detected as a subscription and correctly excluded
// from anomaly detection, which is exactly what the NETFLIX case asserts.

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function charge(
  date: string,
  description: string,
  amount: number,
  category = "Other / uncategorized"
): NewTransaction {
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
    category,
    flow: "spend",
    dedup_key: `test|${seq}`,
  };
}

// Latest data month = 2026-06 throughout.
before(async () => {
  await backend.open();
  await repo.categories.seed();
  const rows: NewTransaction[] = [
    // LUMBER MART: 3 varied prior charges (median $41) → June $180 is 4.4×,
    // over the max(2.5×41, 41+50) = $102.50 bar but under 2× it → warn.
    charge("2026-03-05", "LUMBER MART", 30),
    charge("2026-04-07", "LUMBER MART", 44),
    charge("2026-05-06", "LUMBER MART", 41),
    charge("2026-06-09", "LUMBER MART", 180),
    // TAXI CO: 4 varied prior charges (median $42.50) → June $250 clears
    // 2× the $106.25 threshold → alert.
    charge("2026-02-11", "TAXI CO", 40),
    charge("2026-03-12", "TAXI CO", 35),
    charge("2026-04-10", "TAXI CO", 45),
    charge("2026-05-13", "TAXI CO", 50),
    charge("2026-06-14", "TAXI CO", 250),
    // Groceries pool: 8 single charges at 8 merchants (mean $50, σ ≈ 3.1 →
    // cutoff ≈ $56). MEGA BUTCHER has no history → category path → June $95
    // is over the cutoff and >= $75 → warn.
    charge("2026-01-04", "GREEN GROCER A", 45, "Groceries"),
    charge("2026-01-18", "GREEN GROCER B", 50, "Groceries"),
    charge("2026-02-08", "GREEN GROCER C", 55, "Groceries"),
    charge("2026-02-22", "GREEN GROCER D", 48, "Groceries"),
    charge("2026-03-09", "GREEN GROCER E", 52, "Groceries"),
    charge("2026-04-11", "GREEN GROCER F", 47, "Groceries"),
    charge("2026-05-02", "GREEN GROCER G", 53, "Groceries"),
    charge("2026-05-23", "GREEN GROCER H", 50, "Groceries"),
    charge("2026-06-20", "MEGA BUTCHER", 95, "Groceries"),
    // NETFLIX: known-recurring keyword → detected subscription; the June $80
    // spike would flag via the merchant path (5× the $15.99 median) if the
    // subscription exclusion ever broke.
    charge("2026-01-03", "NETFLIX.COM", 15.99, "Subscriptions"),
    charge("2026-02-03", "NETFLIX.COM", 15.99, "Subscriptions"),
    charge("2026-03-03", "NETFLIX.COM", 15.99, "Subscriptions"),
    charge("2026-04-03", "NETFLIX.COM", 15.99, "Subscriptions"),
    charge("2026-05-03", "NETFLIX.COM", 15.99, "Subscriptions"),
    charge("2026-06-03", "NETFLIX.COM", 80, "Subscriptions"),
    // COFFEE SPOT: prior median $36 → June $80 misses BOTH bars (2.5× = $90,
    // median + $50 = $86) → no flag.
    charge("2026-03-15", "COFFEE SPOT", 30),
    charge("2026-04-16", "COFFEE SPOT", 41),
    charge("2026-05-15", "COFFEE SPOT", 36),
    charge("2026-06-16", "COFFEE SPOT", 80),
    // ODD SHOP: no merchant history and only 2 prior Hobbies charges — the
    // category pool is too thin (< 8) to judge, even at $95 → no flag.
    charge("2026-04-25", "HOBBY HUT", 20, "Hobbies"),
    charge("2026-05-26", "CRAFT CORNER", 25, "Hobbies"),
    charge("2026-06-21", "ODD SHOP", 95, "Hobbies"),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);
});

async function unusual() {
  const insights = await repo.insights.get();
  return insights.filter((i) => i.title.startsWith("Unusual charge:"));
}

test("merchant-relative outlier flags as warn with ratio detail", async () => {
  const hits = await unusual();
  const lumber = hits.find((i) => i.title.includes("LUMBER MART"));
  assert.ok(lumber, "LUMBER MART $180 should be flagged");
  assert.equal(lumber.severity, "warn");
  assert.ok(lumber.title.includes("$180"), lumber.title);
  assert.ok(lumber.detail.includes("4.4×"), lumber.detail);
  assert.ok(lumber.detail.includes("$41"), lumber.detail);
});

test("merchant-relative outlier at 2× the threshold escalates to alert", async () => {
  const hits = await unusual();
  const taxi = hits.find((i) => i.title.includes("TAXI CO"));
  assert.ok(taxi, "TAXI CO $250 should be flagged");
  assert.equal(taxi.severity, "alert");
  assert.ok(taxi.title.includes("$250"), taxi.title);
});

test("category-relative outlier flags when the merchant has no history", async () => {
  const hits = await unusual();
  const butcher = hits.find((i) => i.title.includes("MEGA BUTCHER"));
  assert.ok(butcher, "MEGA BUTCHER $95 should be flagged via the Groceries pool");
  assert.equal(butcher.severity, "warn");
  assert.equal(butcher.category, "Groceries");
  assert.ok(butcher.detail.includes("Groceries"), butcher.detail);
});

test("detected subscriptions are never flagged as one-off anomalies", async () => {
  const hits = await unusual();
  assert.ok(
    !hits.some((i) => i.title.includes("NETFLIX")),
    "the NETFLIX spike is a subscription anomaly, not a one-off"
  );
});

test("below-threshold and thin-history charges do not flag", async () => {
  const hits = await unusual();
  assert.ok(!hits.some((i) => i.title.includes("COFFEE SPOT")), "below both merchant bars");
  assert.ok(!hits.some((i) => i.title.includes("ODD SHOP")), "category pool < 8 charges");
  // Exactly the three engineered hits so far.
  assert.equal(hits.length, 3);
});

test("flags cap at the top 3 by amount", async () => {
  // JEWEL STORE: median $70 → June $200 flags (threshold $175) as a 4th hit;
  // the cap keeps the biggest 3 and drops the smallest (MEGA BUTCHER $95).
  const extra: NewTransaction[] = [
    charge("2026-03-20", "JEWEL STORE", 60),
    charge("2026-04-21", "JEWEL STORE", 80),
    charge("2026-05-20", "JEWEL STORE", 70),
    charge("2026-06-22", "JEWEL STORE", 200),
  ];
  const res = await repo.transactions.insertMany(extra);
  assert.equal(res.inserted, extra.length);

  const hits = await unusual();
  assert.equal(hits.length, 3);
  assert.ok(hits.some((i) => i.title.includes("TAXI CO")));
  assert.ok(hits.some((i) => i.title.includes("JEWEL STORE")));
  assert.ok(hits.some((i) => i.title.includes("LUMBER MART")));
  assert.ok(!hits.some((i) => i.title.includes("MEGA BUTCHER")), "smallest hit drops");
});
