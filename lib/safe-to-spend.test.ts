import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSafeToSpend, SafeToSpendForecast } from "./safe-to-spend";

// Synthetic forecast builder: daily points from the day after `anchor`,
// balances supplied per day, band width fixed at `band`.
function forecast(
  anchor: string,
  balances: number[],
  events: SafeToSpendForecast["events"],
  band = 100
): SafeToSpendForecast {
  const d = new Date(anchor + "T00:00:00");
  const points = balances.map((balance, i) => {
    const x = new Date(d);
    x.setDate(x.getDate() + i + 1);
    const date = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    return { date, balance, low: balance - band, high: balance + band };
  });
  return { anchor: { date: anchor, balance: balances[0] ?? 0 }, staleDays: 0, points, events };
}

const at = (s: string) => new Date(s + "T00:00:00");

test("clear: window ends at first payroll after next rent", () => {
  const fc = forecast(
    "2026-06-30",
    // Jul 1..10 — rent hits Jul 1, payroll Jul 8, drift after
    [800, 700, 650, 600, 550, 500, 450, 2400, 2350, 2300],
    [
      { date: "2026-07-01", label: "Rent + fixed bills", amount: -1900 },
      { date: "2026-07-08", label: "Payroll", amount: 2000 },
    ]
  );
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  assert.equal(s.status, "clear");
  assert.equal(s.windowEnd, "2026-07-08");
  assert.equal(s.windowEndKind, "payroll");
  assert.equal(s.cushion, 450); // lowest is Jul 7, before the payday deposit
  assert.equal(s.lowestDate, "2026-07-07");
  assert.equal(s.daysInWindow, 8);
  assert.equal(s.perDay, 56.25);
  assert.deepEqual(s.nextFixed, { date: "2026-07-01", amount: -1900 });
});

test("tight: balance positive but ±1σ low crosses zero", () => {
  const fc = forecast(
    "2026-06-30",
    [300, 200, 80, 2100],
    [{ date: "2026-07-04", label: "Payroll", amount: 2000 }]
  );
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  assert.equal(s.status, "tight"); // lowest 80, low = 80 − 100 < 0
  assert.equal(s.cushion, 80);
});

test("short: projected below zero before payday", () => {
  const fc = forecast(
    "2026-06-30",
    [200, -150, -300, 1700],
    [{ date: "2026-07-04", label: "Payroll", amount: 2000 }]
  );
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  assert.equal(s.status, "short");
  assert.equal(s.cushion, -300);
  assert.equal(s.perDay, 0);
  assert.equal(s.lowestDate, "2026-07-03");
});

test("window skips a payroll that lands before rent", () => {
  const fc = forecast(
    "2026-06-30",
    [500, 2500, 600, 550, 500, 2450],
    [
      { date: "2026-07-02", label: "Payroll", amount: 2000 },
      { date: "2026-07-03", label: "Rent + fixed bills", amount: -1900 },
      { date: "2026-07-06", label: "Payroll", amount: 2000 },
    ]
  );
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  // Payday on the 2nd is before rent on the 3rd — the window must reach the
  // payday AFTER rent (the 6th), so the post-rent trough counts.
  assert.equal(s.windowEnd, "2026-07-06");
  assert.equal(s.cushion, 500);
  assert.equal(s.lowestDate, "2026-07-01");
});

test("no payroll events: falls back to a 30-day horizon window", () => {
  const balances = Array.from({ length: 60 }, (_, i) => 1000 - i * 10);
  const fc = forecast("2026-06-30", balances, []);
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  assert.equal(s.windowEndKind, "horizon");
  assert.equal(s.daysInWindow, 30);
  assert.equal(s.cushion, 1000 - 29 * 10);
});

test("stale: today past the projection end", () => {
  const fc = forecast("2026-01-31", [500, 450], []);
  const s = deriveSafeToSpend(fc, at("2026-07-01"))!;
  assert.equal(s.status, "stale");
});

test("mid-window start: days before today are ignored", () => {
  const fc = forecast(
    "2026-06-30",
    [50, 400, 350, 2300],
    [{ date: "2026-07-04", label: "Payroll", amount: 2000 }]
  );
  // Jul 1 dipped to 50, but "today" is Jul 2 — that dip is in the past.
  const s = deriveSafeToSpend(fc, at("2026-07-02"))!;
  assert.equal(s.cushion, 350);
  assert.equal(s.daysInWindow, 3);
});

test("empty points returns null", () => {
  assert.equal(
    deriveSafeToSpend({ anchor: { date: "2026-06-30", balance: 0 }, staleDays: 0, points: [], events: [] }),
    null
  );
});
