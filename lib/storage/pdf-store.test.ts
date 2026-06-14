import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import {
  pdfStoreOverBucket,
  buildPdfKey,
  keyBelongsToUser,
  shouldPersistAfterParse,
  purgeUserPdfs,
  userPdfPrefix,
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

test("userPdfPrefix is the per-user object boundary", () => {
  assert.equal(userPdfPrefix("user-1"), "u/user-1/");
  // userIds are URL-encoded so a slash/space can't widen the prefix.
  assert.equal(userPdfPrefix("a/b"), "u/a%2Fb/");
});

test("purgeUserPdfs deletes ONLY the target user's objects (account deletion)", async () => {
  const mf = newMiniflareR2();
  try {
    const bucket = (await mf.getR2Bucket("PDF_BUCKET")) as unknown as R2BucketLike;
    const store = pdfStoreOverBucket(bucket);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9]);

    // user-1 has three objects, user-2 has one.
    const a1 = await store.put("user-1", "jan.pdf", bytes);
    const a2 = await store.put("user-1", "feb.pdf", bytes);
    const a3 = await store.put("user-1", "mar.pdf", bytes);
    const b1 = await store.put("user-2", "jan.pdf", bytes);

    const deleted = await purgeUserPdfs(bucket, "user-1");
    assert.equal(deleted, 3, "all three of user-1's objects are deleted");

    assert.equal(await store.get(a1), null);
    assert.equal(await store.get(a2), null);
    assert.equal(await store.get(a3), null);
    assert.ok(await store.get(b1), "user-2's object is untouched");

    // Idempotent: a second purge finds nothing and reports zero.
    assert.equal(await purgeUserPdfs(bucket, "user-1"), 0);
  } finally {
    await mf.dispose();
  }
});
