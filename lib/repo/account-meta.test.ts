import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Account management (migration 009): nickname / hide / mark-closed round-trip,
// the view-level hidden exclusion (every chart reads v_transactions), the
// data-health completeness contract (hidden accounts stay visible there), the
// net-worth carry-forward stop for closed accounts, and the forecast-anchor
// exclusion. In-memory DoBackend for isolation (see manual-txns.test.ts).

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function txn(
  source: string,
  kind: string,
  date: string,
  description: string,
  amount: number,
  flow = "spend"
): NewTransaction {
  seq++;
  return {
    statement_id: null,
    source,
    account: source.toUpperCase(),
    account_kind: kind,
    period: date.slice(0, 7),
    txn_date: date,
    description,
    amount,
    category: flow === "income" ? "Banking" : "Other / uncategorized",
    flow,
    dedup_key: `test|${seq}`,
  };
}

before(async () => {
  await backend.open();
  await repo.categories.seed();
  const rows: NewTransaction[] = [
    // Two card accounts: amex stays visible, old_visa gets hidden/closed.
    txn("amex", "card", "2026-04-03", "COFFEE BAR", 5.0),
    txn("amex", "card", "2026-05-03", "COFFEE BAR", 6.0),
    txn("old_visa", "card", "2026-04-10", "BIG BOX STORE", 100.0),
    txn("old_visa", "card", "2026-05-10", "BIG BOX STORE", 200.0),
    // Chequing with payroll — feeds getIncomeVsSpend + the forecast anchor.
    txn("cibc_chequing", "chequing", "2026-04-15", "PEOPLE CENTER PAYROLL", 3000, "income"),
    txn("cibc_chequing", "chequing", "2026-04-20", "HYDRO BILL", 80, "spend"),
    txn("cibc_chequing", "chequing", "2026-05-15", "PEOPLE CENTER PAYROLL", 3000, "income"),
    txn("cibc_chequing", "chequing", "2026-05-20", "HYDRO BILL", 80, "spend"),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);

  // Balance-anchored statements for net worth + the cash-flow forecast.
  await repo.statements.insert({
    filename: "cheq-apr.pdf",
    source: "cibc_chequing",
    account: "CHEQ",
    period: "2026-04",
    row_count: 2,
    closing_balance: 1000,
    closing_date: "2026-04-30",
    account_kind: "chequing",
  });
  await repo.statements.insert({
    filename: "cheq-may.pdf",
    source: "cibc_chequing",
    account: "CHEQ",
    period: "2026-05",
    row_count: 2,
    closing_balance: 1200,
    closing_date: "2026-05-31",
    account_kind: "chequing",
  });
  // old_visa's last observation is April — carry-forward into May is the
  // behaviour the closed flag must stop.
  await repo.statements.insert({
    filename: "visa-apr.pdf",
    source: "old_visa",
    account: "VISA",
    period: "2026-04",
    row_count: 2,
    closing_balance: 500,
    closing_date: "2026-04-28",
    account_kind: "card",
  });
});

test("list derives labels and kinds; nickname overrides; partial updates keep other fields", async () => {
  let accounts = await repo.accounts.list();
  const visa = accounts.find((a) => a.source === "old_visa");
  assert.ok(visa);
  assert.equal(visa.kind, "card");
  assert.equal(visa.label, "OLD VISA"); // derived from the source string
  assert.equal(visa.txn_count, 2);
  assert.equal(visa.statement_count, 1);

  assert.equal(await repo.accounts.setMeta("old_visa", { nickname: "Retired card" }), true);
  accounts = await repo.accounts.list();
  assert.equal(accounts.find((a) => a.source === "old_visa")!.label, "Retired card");

  // Toggling hidden must not clobber the nickname (partial upsert).
  await repo.accounts.setMeta("old_visa", { hidden: true });
  const after = (await repo.accounts.list()).find((a) => a.source === "old_visa")!;
  assert.equal(after.nickname, "Retired card");
  assert.equal(after.hidden, true);

  // Clear both for the tests below.
  await repo.accounts.setMeta("old_visa", { nickname: null, hidden: false });
  const cleared = (await repo.accounts.list()).find((a) => a.source === "old_visa")!;
  assert.equal(cleared.nickname, null);
  assert.equal(cleared.label, "OLD VISA");
  assert.equal(cleared.hidden, false);
});

test("setMeta refuses a source with no data behind it", async () => {
  assert.equal(await repo.accounts.setMeta("nonexistent_bank", { hidden: true }), false);
});

test("hidden accounts leave every v_transactions reader but stay in data health", async () => {
  const visibleBefore = await repo.transactions.list({});
  const mayBefore = (await repo.summary.monthlyTotals()).find((m) => m.month === "2026-05");
  assert.ok(mayBefore);

  await repo.accounts.setMeta("old_visa", { hidden: true });

  // Transactions list (the view) drops the hidden account's rows...
  const visible = await repo.transactions.list({});
  assert.equal(visible.total, visibleBefore.total - 2);
  assert.ok(visible.rows.every((r) => r.source !== "old_visa"));

  // ...and so do the spend charts (May: $200 of old_visa spend gone).
  const may = (await repo.summary.monthlyTotals()).find((m) => m.month === "2026-05");
  assert.ok(may);
  assert.ok(Math.abs(mayBefore.total - may.total - 200) < 1e-9);

  // Data health reads the base table: the account stays listed (flagged), and
  // the transaction total still counts every stored row.
  const health = await repo.profile.dataHealth();
  const row = health.sources.find((s) => s.source === "old_visa");
  assert.ok(row, "hidden account must stay in data health");
  assert.equal(row.hidden, true);
  assert.equal(health.transactions, 8);

  // Net worth loses the hidden card's balance entirely.
  const nw = await repo.netWorth.get();
  assert.ok(nw.accounts.every((a) => a.name !== "VISA"));

  await repo.accounts.setMeta("old_visa", { hidden: false });
});

test("closed stops net-worth carry-forward after the last observation", async () => {
  let nw = await repo.netWorth.get();
  const last = nw.series[nw.series.length - 1];
  assert.equal(last.month, "2026-05");
  // Open: April's -500 carries into May.
  assert.equal(last.balances["VISA"], -500);

  await repo.accounts.setMeta("old_visa", { closed: true });
  nw = await repo.netWorth.get();
  const april = nw.series.find((p) => p.month === "2026-04");
  const may = nw.series[nw.series.length - 1];
  assert.equal(april!.balances["VISA"], -500, "history up to the close is untouched");
  assert.equal(may.balances["VISA"], undefined, "closed balance must not carry forward");
  assert.equal(nw.accounts.find((a) => a.name === "VISA")!.closed, true);

  // Closed ≠ hidden: the card's transactions stay in the charts.
  const visible = await repo.transactions.list({});
  assert.ok(visible.rows.some((r) => r.source === "old_visa"));

  await repo.accounts.setMeta("old_visa", { closed: false });
});

test("data health suppresses nothing for closed except via the closed flag", async () => {
  await repo.accounts.setMeta("cibc_chequing", { closed: true });
  const health = await repo.profile.dataHealth();
  const cheq = health.sources.find((s) => s.source === "cibc_chequing")!;
  assert.equal(cheq.closed, true);
  await repo.accounts.setMeta("cibc_chequing", { closed: false });
});

test("a closed chequing account no longer anchors the cash-flow forecast", async () => {
  // Anchored + payroll months present → the forecast engine runs.
  const now = new Date("2026-06-05T12:00:00Z");
  const open = await repo.cashflowForecast.get(now);
  assert.ok(open, "forecast should produce with an open anchored account");

  await repo.accounts.setMeta("cibc_chequing", { closed: true });
  const closed = await repo.cashflowForecast.get(now);
  assert.equal(closed, null, "closed account must not anchor the projection");

  await repo.accounts.setMeta("cibc_chequing", { closed: false });
});

test("net worth exposes nicknames as display labels; timeline keys stay the account name", async () => {
  await repo.accounts.setMeta("old_visa", { nickname: "Retired card" });
  const nw = await repo.netWorth.get();
  const visa = nw.accounts.find((a) => a.name === "VISA")!;
  assert.equal(visa.label, "Retired card");
  assert.equal(nw.accounts.find((a) => a.name === "CHEQ")!.label, undefined);
  // balances stay keyed by the account NAME — a nickname collision must never
  // merge two accounts' histories.
  const april = nw.series.find((p) => p.month === "2026-04")!;
  assert.ok("VISA" in april.balances);
  assert.ok(!("Retired card" in april.balances));
  await repo.accounts.setMeta("old_visa", { nickname: null });
});

// NOTE: keep this test LAST — its inserts change totals the earlier tests
// assert on (e.g. health.transactions).
test("data health flags synced sources via the *.sync statement filename", async () => {
  // A SimpleFIN-synced source: `<source>.sync` is the per-account statement
  // filename the sync core UPSERTs (lib/simplefin/sync.ts).
  await repo.transactions.insertMany([
    txn("simplefin_abc123", "card", "2026-05-02", "STREAMING SUB", 12.99),
  ]);
  await repo.statements.insert({
    filename: "simplefin_abc123.sync",
    source: "simplefin_abc123",
    account: "Cashback Card",
    period: "2026-05-01 to 2026-05-31",
    row_count: 1,
    closing_balance: null,
    closing_date: null,
    account_kind: "card",
  });

  const health = await repo.profile.dataHealth();
  const synced = health.sources.find((s) => s.source === "simplefin_abc123");
  assert.ok(synced, "synced source must appear in data health");
  assert.equal(synced.synced, true);

  // Upload-fed sources (normal statement filenames) stay txn-clocked.
  assert.equal(health.sources.find((s) => s.source === "cibc_chequing")!.synced, false);
  assert.equal(health.sources.find((s) => s.source === "old_visa")!.synced, false);
  // A source with no statement rows at all → not synced either.
  assert.equal(health.sources.find((s) => s.source === "amex")!.synced, false);
});
