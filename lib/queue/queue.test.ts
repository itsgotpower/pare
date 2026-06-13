import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { enqueueParseJob } from "./producer";
import {
  jobStoreOverKv,
  jobKey,
  jobBelongsToUser,
  type KvNamespaceLike,
  type ParseJobRecord,
} from "./job-store";
import type { ParseJobMessage, QueueLike, QueueSendOptions } from "./types";

// ---------------------------------------------------------------------------
// Node-level unit tests for the P4 producer + JobStore. The producer is tested
// against a fake Queue (round-trips the message + options); the JobStore against
// REAL (miniflare) KV, mirroring pdf-store.test.ts's miniflare-R2 approach.
// ---------------------------------------------------------------------------

function newMiniflareKv() {
  return new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    kvNamespaces: { PARSE_JOBS: "parse-jobs" },
  });
}

test("enqueueParseJob sends the message with contentType json", async () => {
  let sentBody: ParseJobMessage | null = null;
  let sentOpts: QueueSendOptions | undefined;
  const fakeQueue: QueueLike<ParseJobMessage> = {
    async send(body, options) {
      sentBody = body;
      sentOpts = options;
    },
  };

  const msg: ParseJobMessage = {
    userId: "alice",
    r2Key: "u/alice/abc-statement.pdf",
    filename: "statement.pdf",
    jobId: "job-1",
  };
  await enqueueParseJob(fakeQueue, msg);

  assert.deepEqual(sentBody, msg, "the exact message body is sent");
  assert.equal(sentOpts?.contentType, "json", "sent as structured JSON");
});

test("jobKey / jobBelongsToUser enforce the per-user prefix", () => {
  const k = jobKey("alice", "job-1");
  assert.equal(k, "job/alice/job-1");
  assert.ok(jobBelongsToUser(k, "alice"));
  assert.ok(!jobBelongsToUser(k, "bob"), "alice's job key does not belong to bob");
});

test("KvJobStore: create -> markParsing -> markDone lifecycle", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);

    const created = await store.create({ jobId: "j1", userId: "alice", filename: "s.pdf" });
    assert.equal(created.status, "queued");
    assert.equal(created.inserted, null);

    await store.markParsing("alice", "j1");
    assert.equal((await store.get("alice", "j1"))?.status, "parsing");

    await store.markDone("alice", "j1", { inserted: 5, skipped: 2 });
    const done = await store.get("alice", "j1");
    assert.equal(done?.status, "done");
    assert.equal(done?.inserted, 5);
    assert.equal(done?.skipped, 2);
    assert.equal(done?.error, null);
    // updatedAt advanced past createdAt-equal-at-create (monotonic ISO strings).
    assert.ok((done as ParseJobRecord).updatedAt >= created.createdAt);
  } finally {
    await mf.dispose();
  }
});

test("KvJobStore: markFailed records the error", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);
    await store.create({ jobId: "j2", userId: "alice", filename: "s.pdf" });
    await store.markFailed("alice", "j2", "container 502: boom");
    const job = await store.get("alice", "j2");
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /container 502/);
  } finally {
    await mf.dispose();
  }
});

test("KvJobStore: a caller can only read their OWN jobs (cross-user isolation)", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);

    await store.create({ jobId: "shared-id", userId: "alice", filename: "a.pdf" });
    await store.create({ jobId: "shared-id", userId: "bob", filename: "b.pdf" });

    // Same jobId, different owners -> disjoint records under disjoint keys.
    assert.equal((await store.get("alice", "shared-id"))?.filename, "a.pdf");
    assert.equal((await store.get("bob", "shared-id"))?.filename, "b.pdf");

    // A user asking for a jobId they don't own gets null, never the other's record.
    assert.equal(await store.get("carol", "shared-id"), null);
  } finally {
    await mf.dispose();
  }
});

test("KvJobStore: markDone is idempotent — a redelivery's {0,0} can't clobber a prior done", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);
    await store.create({ jobId: "jd", userId: "alice", filename: "s.pdf" });

    // First run records the real counts.
    await store.markDone("alice", "jd", { inserted: 7, skipped: 1 });
    // A Queue redelivery re-runs; the second insert all-dedups -> {0,0}. markDone
    // must NOT overwrite the already-done record.
    await store.markDone("alice", "jd", { inserted: 0, skipped: 8 });

    const job = await store.get("alice", "jd");
    assert.equal(job?.status, "done");
    assert.equal(job?.inserted, 7, "kept the first run's inserted count");
    assert.equal(job?.skipped, 1, "kept the first run's skipped count");
  } finally {
    await mf.dispose();
  }
});

test("KvJobStore: markRetrying is non-terminal and never overwrites a done job", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);

    // A transient failure marks the job `retrying` (the client keeps polling).
    await store.create({ jobId: "jr", userId: "alice", filename: "s.pdf" });
    await store.markRetrying("alice", "jr", "container 502");
    const retrying = await store.get("alice", "jr");
    assert.equal(retrying?.status, "retrying");
    assert.match(retrying?.error ?? "", /container 502/);

    // A late retry arriving after success must not flip done -> retrying.
    await store.create({ jobId: "jr2", userId: "alice", filename: "s.pdf" });
    await store.markDone("alice", "jr2", { inserted: 3, skipped: 0 });
    await store.markRetrying("alice", "jr2", "late blip");
    const stillDone = await store.get("alice", "jr2");
    assert.equal(stillDone?.status, "done");
    assert.equal(stillDone?.inserted, 3);
  } finally {
    await mf.dispose();
  }
});

test("KvJobStore: advancing a non-existent job is a no-op (never resurrects)", async () => {
  const mf = newMiniflareKv();
  try {
    const kv = (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike;
    const store = jobStoreOverKv(kv);
    await store.markDone("ghost", "nope", { inserted: 1, skipped: 0 });
    assert.equal(await store.get("ghost", "nope"), null);
  } finally {
    await mf.dispose();
  }
});
