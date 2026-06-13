import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import {
  pdfStoreOverBucket,
  buildPdfKey,
  keyBelongsToUser,
  shouldPersistAfterParse,
  type R2BucketLike,
} from "./pdf-store";

// ---------------------------------------------------------------------------
// PdfStore over Cloudflare's REAL R2, running inside the Workers runtime via
// miniflare (mirrors do-backend.test.ts Part 2). miniflare's getR2Bucket()
// returns a bucket implementing the same structural surface R2PdfStore needs
// (put/get/delete), so the production class is exercised against real R2.
// ---------------------------------------------------------------------------

function newMiniflareR2() {
  const mf = new Miniflare({
    modules: true,
    // A no-op Worker; we only need the R2 binding, driven from the host.
    script: "export default { fetch() { return new Response('ok'); } };",
    r2Buckets: { PDF_BUCKET: "pdf-bucket" },
  });
  return mf;
}

test("R2PdfStore: put/get/delete round-trips PDF bytes through real R2", async () => {
  const mf = newMiniflareR2();
  try {
    const bucket = (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike;
    const store = pdfStoreOverBucket(bucket);

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5]); // "%PDF" + payload
    const key = await store.put("user-1", "statement.pdf", bytes);

    const got = await store.get(key);
    assert.ok(got, "object is retrievable after put");
    assert.deepEqual(got, bytes, "bytes round-trip byte-for-byte through R2");

    await store.delete(key);
    const afterDelete = await store.get(key);
    assert.equal(afterDelete, null, "object is gone after delete (default retention)");
  } finally {
    await mf.dispose();
  }
});

test("R2PdfStore: keys are prefixed per user (one user can't address another's object)", async () => {
  const mf = newMiniflareR2();
  try {
    const bucket = (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike;
    const store = pdfStoreOverBucket(bucket);

    const aKey = await store.put("alice", "march.pdf", new Uint8Array([1]));
    const bKey = await store.put("bob", "march.pdf", new Uint8Array([2]));

    // Same filename, but the per-user prefix keeps the keys disjoint.
    assert.ok(aKey.startsWith("u/alice/"), `alice's key is under her prefix: ${aKey}`);
    assert.ok(bKey.startsWith("u/bob/"), `bob's key is under his prefix: ${bKey}`);
    assert.notEqual(aKey, bKey);

    // The guard rejects a cross-user key — the boundary P4/P5 enforce.
    assert.ok(keyBelongsToUser(aKey, "alice"));
    assert.ok(!keyBelongsToUser(aKey, "bob"), "alice's key does NOT belong to bob");
    assert.ok(!keyBelongsToUser(bKey, "alice"), "bob's key does NOT belong to alice");

    // And the bytes are independently retrievable, not collided.
    assert.deepEqual(await store.get(aKey), new Uint8Array([1]));
    assert.deepEqual(await store.get(bKey), new Uint8Array([2]));
  } finally {
    await mf.dispose();
  }
});

test("buildPdfKey: per-user prefix, unique uuid, sanitized filename", () => {
  const k1 = buildPdfKey("user-1", "My Statement (May).pdf");
  const k2 = buildPdfKey("user-1", "My Statement (May).pdf");

  assert.ok(k1.startsWith("u/user-1/"), "carries the per-user prefix");
  assert.notEqual(k1, k2, "two uploads of the same name get distinct keys (uuid)");
  assert.ok(!/[()\s]/.test(k1), "filename is sanitized of spaces/parens");

  // A path-traversal attempt in the filename can't escape the user prefix.
  const evil = buildPdfKey("user-1", "../../etc/passwd");
  assert.ok(evil.startsWith("u/user-1/"), "traversal filename stays under the prefix");
  assert.ok(!evil.includes(".."), "no .. segments survive sanitisation");
});

test("get returns null for an absent key", async () => {
  const mf = newMiniflareR2();
  try {
    const bucket = (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike;
    const store = pdfStoreOverBucket(bucket);
    assert.equal(await store.get("u/nobody/does-not-exist.pdf"), null);
  } finally {
    await mf.dispose();
  }
});

test("shouldPersistAfterParse defaults to false (delete-after-parse retention)", () => {
  assert.equal(shouldPersistAfterParse(), false);
});
