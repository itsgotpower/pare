import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { pdfStoreOverBucket, keyBelongsToUser, type R2BucketLike } from "../storage/pdf-store";
import { jobStoreOverKv, type KvNamespaceLike } from "./job-store";
import { handleHostedUpload } from "./upload-handler";
import type { ParseJobMessage, QueueLike, QueueSendOptions } from "./types";

// ---------------------------------------------------------------------------
// P5 hosted upload — the request-side pipeline (handleHostedUpload), exercised
// over REAL (miniflare) R2 + KV and a fake Queue. We assert the four steps the
// route performs once the caller is authenticated:
//   PdfStore.put -> jobStore.create(queued) -> enqueueParseJob -> { jobId }
// and prove the per-user isolation the status endpoint relies on.
//
// The 401 path is the route's resolveUser gate (covered by lib/auth/resolve.test.ts
// for the resolver itself); here we prove that GIVEN an authenticated userId the
// pipeline writes only under that user's prefixes and that user B can't read
// user A's job (the status endpoint's get(authedUserId, jobId) -> 404 behaviour).
// ---------------------------------------------------------------------------

function newMiniflare() {
  return new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    r2Buckets: { PDF_BUCKET: "pdf-bucket" },
    kvNamespaces: { PARSE_JOBS: "parse-jobs" },
  });
}

function recordingQueue() {
  const sent: { body: ParseJobMessage; options?: QueueSendOptions }[] = [];
  const queue: QueueLike<ParseJobMessage> = {
    async send(body, options) {
      sent.push({ body, options });
    },
  };
  return { queue, sent };
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // "%PDF" + payload

test("handleHostedUpload: stores PDF, creates a queued job, enqueues, returns jobId", async () => {
  const mf = newMiniflare();
  try {
    const pdfStore = pdfStoreOverBucket(
      (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike
    );
    const jobStore = jobStoreOverKv(
      (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike
    );
    const { queue, sent } = recordingQueue();

    const { jobId } = await handleHostedUpload(
      { userId: "alice", filename: "amex-2026-05.pdf", bytes: PDF_BYTES },
      { pdfStore, jobStore, queue, newJobId: () => "job-fixed-1" }
    );

    // Returns the jobId the route replies 202 with.
    assert.equal(jobId, "job-fixed-1");

    // A `queued` job record exists for alice and is readable via the status path.
    const job = await jobStore.get("alice", jobId);
    assert.equal(job?.status, "queued");
    assert.equal(job?.filename, "amex-2026-05.pdf");
    assert.equal(job?.userId, "alice");
    assert.equal(job?.inserted, null);

    // Exactly one parse message was enqueued, with the per-user r2Key + jobId.
    assert.equal(sent.length, 1);
    const msg = sent[0].body;
    assert.equal(msg.userId, "alice");
    assert.equal(msg.jobId, "job-fixed-1");
    assert.equal(msg.filename, "amex-2026-05.pdf");
    assert.ok(keyBelongsToUser(msg.r2Key, "alice"), "r2Key lives under alice's prefix");
    assert.equal(sent[0].options?.contentType, "json");

    // The PDF bytes really landed in R2 at that key.
    const stored = await pdfStore.get(msg.r2Key);
    assert.deepEqual(stored, PDF_BYTES);
  } finally {
    await mf.dispose();
  }
});

test("status lookup: user B cannot read user A's job (per-user 404)", async () => {
  const mf = newMiniflare();
  try {
    const pdfStore = pdfStoreOverBucket(
      (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike
    );
    const jobStore = jobStoreOverKv(
      (await mf.getKVNamespace("PARSE_JOBS")) as unknown as KvNamespaceLike
    );
    const { queue } = recordingQueue();

    const { jobId } = await handleHostedUpload(
      { userId: "alice", filename: "a.pdf", bytes: PDF_BYTES },
      { pdfStore, jobStore, queue, newJobId: () => "job-A" }
    );

    // The endpoint scopes by the AUTHED userId: get(authedUserId, jobId).
    // Alice (the owner) reads her job; Bob asking for the same jobId gets null
    // (-> the route returns 404), never alice's record.
    assert.ok(await jobStore.get("alice", jobId), "owner reads their job");
    assert.equal(await jobStore.get("bob", jobId), null, "non-owner gets null -> 404");
  } finally {
    await mf.dispose();
  }
});
