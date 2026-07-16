import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SqliteRepo } from "./sqlite-repo";
import { DoBackend, MemoryDurableStore } from "./do-backend";
import { FEEDBACK_MESSAGE_MAX } from "../db/feedback";

// Product feedback store over the hosted (DO) backend: submit validation
// (kind / message caps / optional email) and the admin-export read path.
// In-memory DoBackend for isolation (see manual-txns.test.ts).

const backend = new DoBackend(new MemoryDurableStore());
const repo = new SqliteRepo(backend);

before(async () => {
  await backend.open();
});

test("submit round-trips and list preserves submission order", async () => {
  assert.equal((await repo.feedback.submit("bug", "Charts blank on Safari")).ok, true);
  assert.equal(
    (await repo.feedback.submit("idea", "CSV export per category", "a@b.co")).ok,
    true
  );

  const entries = await repo.feedback.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "bug");
  assert.equal(entries[0].message, "Charts blank on Safari");
  assert.equal(entries[0].email, null);
  assert.equal(entries[1].kind, "idea");
  assert.equal(entries[1].email, "a@b.co");
});

test("rejects unknown kind, empty message, oversized message", async () => {
  assert.equal((await repo.feedback.submit("rant", "hello")).ok, false);
  assert.equal((await repo.feedback.submit("bug", "   ")).ok, false);
  const oversized = "x".repeat(FEEDBACK_MESSAGE_MAX + 1);
  assert.equal((await repo.feedback.submit("bug", oversized)).ok, false);
  // Exactly at the cap is fine.
  assert.equal((await repo.feedback.submit("bug", "y".repeat(FEEDBACK_MESSAGE_MAX))).ok, true);
});

test("email is optional but validated + normalized when present", async () => {
  assert.equal((await repo.feedback.submit("other", "no reply needed")).ok, true);
  assert.equal((await repo.feedback.submit("other", "bad addr", "not-an-email")).ok, false);
  assert.equal((await repo.feedback.submit("other", "long addr", `x@${"y".repeat(255)}.co`)).ok, false);

  assert.equal((await repo.feedback.submit("other", "reply pls", "  User@Example.COM ")).ok, true);
  const entries = await repo.feedback.list();
  assert.equal(entries[entries.length - 1].email, "user@example.com");
});
