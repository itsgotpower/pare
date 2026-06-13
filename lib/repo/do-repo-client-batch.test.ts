import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import { inProcessRepoForUser } from "./index";
import type { NewTransaction } from "./types";

// Regression for the hosted upload 500 (code review #1).
//
// Inside DoRepoClient.batch() every WRITE is buffered and returns a placeholder
// (the real result only exists once the batch is shipped to the DO). The upload
// route previously did `if (result.inserted > 0)` on that placeholder (undefined)
// and threw on every hosted upload. The contract that makes the route correct is:
// batch() returns the FIRST buffered write's real result (returnIndex 0), so the
// route reads {inserted, skipped} off the batch's return value, never off a
// write's return mid-closure. The two-user isolation test drives insertMany inside
// batch() but never reads the return, so it did not catch this; this test does.

function rows(...keys: string[]): NewTransaction[] {
  return keys.map((dedup_key, i) => ({
    statement_id: null,
    source: "amex",
    account: "card",
    period: "2026-05",
    txn_date: `2026-05-${String(10 + i).padStart(2, "0")}`,
    description: `MERCHANT ${dedup_key}`,
    amount: 10 + i,
    category: "Other / uncategorized",
    flow: "spend",
    dedup_key,
  }));
}

test("DoRepoClient.batch surfaces insertMany's real result (hosted upload counts)", async () => {
  const perUser = new SqliteRepo(new DoBackend(new MemoryDurableStore()));
  const repo = inProcessRepoForUser(perUser); // production DO envelope, in-process

  // Mirror app/api/upload/route.ts exactly: insertMany + recategorizeAll in ONE
  // batch, then destructure the batch return. Must not throw, must carry counts.
  const first = await repo.batch(async () => {
    const result = await repo.transactions.insertMany(rows("u1", "u2"));
    await repo.categories.recategorizeAll();
    return result;
  });
  assert.equal(first.inserted, 2);
  assert.equal(first.skipped, 0);

  // Re-upload the same rows: dedup -> 0 inserted, 2 skipped (still via the return).
  const second = await repo.batch(async () => {
    const result = await repo.transactions.insertMany(rows("u1", "u2"));
    await repo.categories.recategorizeAll();
    return result;
  });
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 2);
});
