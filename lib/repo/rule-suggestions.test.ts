import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import type { NewTransaction } from "./types";

// Rule-suggestion mining quality gates + dismissal. The raw longest-common-
// substring of override descriptions loves trailing city tokens ("VANCOUVER"),
// which would re-tag hundreds of unrelated rows; the position and collateral
// gates must keep those out while a genuine merchant substring ("NETFLIX")
// still comes through, and a REJECTed suggestion must never resurface.

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

let seq = 0;
function row(description: string, category: string): NewTransaction {
  seq++;
  return {
    statement_id: null,
    source: "cibc_visa",
    account: "card",
    account_kind: "card",
    period: "2026-06",
    txn_date: "2026-06-15",
    description,
    amount: 25,
    category,
    flow: "spend",
    dedup_key: `sugg|${seq}`,
  };
}

async function idOf(description: string): Promise<number> {
  const { rows } = await repo.transactions.list({ search: description });
  assert.ok(rows.length > 0, `no row found for ${description}`);
  return rows[0].id;
}

before(async () => {
  await backend.open();
  const rows: NewTransaction[] = [
    // Two unrelated merchants whose only common substring is the trailing city.
    row("URBAN FARE STORE VANCOUVER BC", "Other / uncategorized"),
    row("CITY MARKET FOODS VANCOUVER BC", "Other / uncategorized"),
    // Collateral: VANCOUVER rows already filed under several real categories.
    row("BLENZ COFFEE VANCOUVER BC", "Coffee"),
    row("SUSHI HERO VANCOUVER BC", "Restaurants & takeout"),
    row("YVR PARKING VANCOUVER BC", "Transport / gas / parking"),
    // A genuine merchant: two rows to override + one more it should claim.
    row("NETFLIX.COM 1001 ON", "Other / uncategorized"),
    row("NETFLIX.COM 1002 ON", "Other / uncategorized"),
    row("NETFLIX.COM 1003 ON", "Other / uncategorized"),
  ];
  const res = await repo.transactions.insertMany(rows);
  assert.equal(res.inserted, rows.length);

  // Overrides that would previously mine "VANCOUVER BC" → Groceries.
  await repo.categories.addOverride(
    await idOf("URBAN FARE"), "Other / uncategorized", "Groceries");
  await repo.categories.addOverride(
    await idOf("CITY MARKET"), "Other / uncategorized", "Groceries");
  // Overrides that should mine "NETFLIX.COM" → Subscriptions.
  await repo.categories.addOverride(
    await idOf("NETFLIX.COM 1001"), "Other / uncategorized", "Subscriptions");
  await repo.categories.addOverride(
    await idOf("NETFLIX.COM 1002"), "Other / uncategorized", "Subscriptions");
});

test("trailing city tokens are not suggested; merchant substrings are", async () => {
  const suggestions = await repo.categories.ruleSuggestions();
  assert.ok(
    !suggestions.some((s) => s.keyword.includes("VANCOUVER")),
    `city token leaked into suggestions: ${JSON.stringify(suggestions)}`
  );
  const netflix = suggestions.find((s) => s.category === "Subscriptions");
  assert.ok(netflix, "merchant suggestion missing");
  assert.ok(netflix.keyword.includes("NETFLIX"), `keyword was ${netflix.keyword}`);
  assert.ok(netflix.count >= 1, "should count the un-overridden NETFLIX row");
});

test("a dismissed suggestion never resurfaces", async () => {
  const [s] = (await repo.categories.ruleSuggestions()).filter(
    (x) => x.category === "Subscriptions"
  );
  assert.ok(s);
  await repo.categories.dismissSuggestion(s.keyword, s.category);
  const after = await repo.categories.ruleSuggestions();
  assert.ok(
    !after.some((x) => x.keyword === s.keyword && x.category === s.category),
    "dismissed suggestion came back"
  );
});

test("an accepted keyword (existing rule) is no longer suggested", async () => {
  // Different category, same keyword shape: overriding two SPOTIFY rows mines
  // "SPOTIFY", but once the rule exists the suggestion must disappear.
  const rows = [
    row("SPOTIFY P2ABC123 ON", "Other / uncategorized"),
    row("SPOTIFY P2DEF456 ON", "Other / uncategorized"),
  ];
  await repo.transactions.insertMany(rows);
  await repo.categories.addOverride(
    await idOf("SPOTIFY P2ABC123"), "Other / uncategorized", "Subscriptions");
  await repo.categories.addOverride(
    await idOf("SPOTIFY P2DEF456"), "Other / uncategorized", "Subscriptions");

  const mined = await repo.categories.ruleSuggestions();
  const spotify = mined.find((s) => s.keyword.includes("SPOTIFY"));
  assert.ok(spotify, "SPOTIFY should be suggested before the rule exists");

  await repo.categories.addRule("Subscriptions", spotify.keyword);
  const after = await repo.categories.ruleSuggestions();
  assert.ok(
    !after.some((s) => s.keyword.includes("SPOTIFY")),
    "existing rule keyword still suggested"
  );
});
