import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Year-over-year summary (lib/db/yoy.ts via repo.summary.yoy()): the <13-months
// empty result, 12-vs-12 month alignment (including a gap month reading 0, not
// null, once it's inside coverage), per-category deltas for the latest month vs
// the same month last year (new category → pct null, vanished category → −100%),
// and the slice contract — split parts count under their own categories while
// monthly totals keep reading whole parents.
// In-memory DoBackend for isolation (see splits.test.ts).

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function spend(date: string, description: string, amount: number, category: string): NewTransaction {
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
    dedup_key: `yoy-test|${seq}`,
  };
}

// A "standard" month: Groceries 100 + Coffee 50 = 150 total.
function standardMonth(ym: string): NewTransaction[] {
  return [
    spend(`${ym}-05`, "GROCER MART", 100, "Groceries"),
    spend(`${ym}-12`, "BEAN BAR", 50, "Coffee"),
  ];
}

function monthRange(fromYm: string, toYm: string): string[] {
  const parse = (ym: string) => {
    const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
    return y * 12 + (m - 1);
  };
  const out: string[] = [];
  for (let i = parse(fromYm); i <= parse(toYm); i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

before(async () => {
  await backend.open();
  await repo.categories.seed();
  // Phase 1: only 6 months of data (2026-01..2026-06). The latest month is
  // deliberately non-standard so the later per-category assertions bite.
  const rows: NewTransaction[] = [
    ...monthRange("2026-01", "2026-05").flatMap(standardMonth),
    spend("2026-06-05", "GROCER MART", 150, "Groceries"),
    spend("2026-06-12", "BEAN BAR", 30, "Coffee"),
    spend("2026-06-20", "ARCADE PALACE", 40, "Fun money"),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);
});

test("fewer than 13 data months yields the empty result", async () => {
  const yoy = await repo.summary.yoy();
  assert.equal(yoy.hasFullYear, false);
  assert.equal(yoy.monthsOfData, 6);
  assert.equal(yoy.latestMonth, "2026-06");
  assert.equal(yoy.comparisonMonth, null);
  assert.equal(yoy.latestTotal, 0);
  assert.equal(yoy.comparisonTotal, 0);
  assert.equal(yoy.totalDelta, 0);
  assert.equal(yoy.totalPct, null);
  assert.deepEqual(yoy.categories, []);
  assert.deepEqual(yoy.months, []);
});

test("two years of months: alignment, totals, per-category deltas", async () => {
  // Phase 2: backfill 2024-06..2025-12, SKIPPING 2025-01 (a gap month) and
  // making 2025-06 (the comparison month) non-standard: 100 + 50 + Transit 60.
  const rows: NewTransaction[] = [
    ...monthRange("2024-06", "2024-12").flatMap(standardMonth),
    ...monthRange("2025-02", "2025-05").flatMap(standardMonth),
    ...standardMonth("2025-06"),
    spend("2025-06-18", "CITY TRANSIT PASS", 60, "Transit"),
    ...monthRange("2025-07", "2025-12").flatMap(standardMonth),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);

  const yoy = await repo.summary.yoy();
  assert.equal(yoy.hasFullYear, true);
  assert.equal(yoy.monthsOfData, 24); // 25 calendar months minus the 2025-01 gap
  assert.equal(yoy.latestMonth, "2026-06");
  assert.equal(yoy.comparisonMonth, "2025-06");

  // Totals: latest 150+30+40, comparison 100+50+60.
  assert.equal(yoy.latestTotal, 220);
  assert.equal(yoy.comparisonTotal, 210);
  assert.equal(yoy.totalDelta, 10);
  assert.ok(Math.abs((yoy.totalPct ?? 0) - (10 / 210) * 100) < 1e-9);

  // Overlay: 12 points, oldest first, each paired with the month exactly 12
  // calendar months earlier.
  assert.equal(yoy.months.length, 12);
  assert.deepEqual(
    yoy.months.map((m) => m.offset),
    Array.from({ length: 12 }, (_, i) => i)
  );
  for (const p of yoy.months) {
    const [y, m] = p.month.split("-");
    assert.equal(p.prevMonth, `${parseInt(y, 10) - 1}-${m}`);
  }

  const first = yoy.months[0];
  assert.deepEqual(first, {
    offset: 0,
    month: "2025-07",
    total: 150,
    prevMonth: "2024-07",
    prevTotal: 150,
  });

  const last = yoy.months[11];
  assert.equal(last.month, "2026-06");
  assert.equal(last.total, 220);
  assert.equal(last.prevMonth, "2025-06");
  assert.equal(last.prevTotal, 210);

  // The gap: 2026-01's pair is 2025-01, which is inside coverage but had no
  // spend — it must read 0 (a real no-spend month), not null (unknown).
  const jan = yoy.months.find((m) => m.month === "2026-01");
  assert.ok(jan);
  assert.equal(jan.prevMonth, "2025-01");
  assert.equal(jan.prevTotal, 0);

  // Per-category deltas, biggest |delta| first.
  assert.deepEqual(
    yoy.categories.map((c) => c.category),
    ["Transit", "Groceries", "Fun money", "Coffee"]
  );
  const byCat = new Map(yoy.categories.map((c) => [c.category, c]));

  const groceries = byCat.get("Groceries")!;
  assert.deepEqual(groceries, {
    category: "Groceries",
    current: 150,
    previous: 100,
    delta: 50,
    pct: 50,
  });

  // Vanished category: present a year ago, absent now → −100%.
  const transit = byCat.get("Transit")!;
  assert.deepEqual(transit, {
    category: "Transit",
    current: 0,
    previous: 60,
    delta: -60,
    pct: -100,
  });

  // New category: nothing a year ago → pct is null, never Infinity.
  const fun = byCat.get("Fun money")!;
  assert.deepEqual(fun, {
    category: "Fun money",
    current: 40,
    previous: 0,
    delta: 40,
    pct: null,
  });

  const coffee = byCat.get("Coffee")!;
  assert.equal(coffee.delta, -20);
  assert.equal(coffee.pct, -40);
});

test("split parts count under their own categories; totals keep reading parents", async () => {
  // A $40 charge in the latest month, split 25/15 across two categories.
  await repo.transactions.insertMany([
    spend("2026-06-25", "MIXED BASKET", 40, "Groceries"),
  ]);
  const db = await backend.open();
  const { id } = db
    .prepare("SELECT id FROM transactions WHERE description = 'MIXED BASKET'")
    .get() as { id: number };
  await repo.splits.set(id, [
    { category: "Groceries", amount: 25 },
    { category: "Office supplies", amount: 15 },
  ]);

  const yoy = await repo.summary.yoy();

  // Monthly totals read whole parents: +40 on the latest month.
  assert.equal(yoy.latestTotal, 260);
  assert.equal(yoy.totalDelta, 50);
  assert.equal(yoy.months[11].total, 260);

  // Category deltas read slices: Groceries gains only its $25 part, and the
  // other part surfaces as its own (new) category.
  const byCat = new Map(yoy.categories.map((c) => [c.category, c]));
  assert.equal(byCat.get("Groceries")!.current, 175);
  assert.equal(byCat.get("Groceries")!.delta, 75);
  const office = byCat.get("Office supplies")!;
  assert.deepEqual(office, {
    category: "Office supplies",
    current: 15,
    previous: 0,
    delta: 15,
    pct: null,
  });

  // Slices reconcile with the parent total for the latest month.
  const sliceSum = yoy.categories.reduce((s, c) => s + c.current, 0);
  assert.equal(sliceSum, yoy.latestTotal);

  // Re-sorted by |delta| with the new numbers.
  assert.deepEqual(
    yoy.categories.map((c) => c.category),
    ["Groceries", "Transit", "Fun money", "Coffee", "Office supplies"]
  );
});
