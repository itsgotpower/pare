import { test } from "node:test";
import assert from "node:assert/strict";
import { handleInboundEmail, addressToken, type InboundDeps } from "./inbound";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const NOT_PDF = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic

// A deps stub that records calls, so each test can assert what the pipeline did.
function stub(over: Partial<InboundDeps> = {}) {
  const uploads: { userId: string; filename: string }[] = [];
  let n = 0;
  const deps: InboundDeps = {
    lookupUser: async (token) => (token === "good" ? "u1" : null),
    upload: async ({ userId, filename }) => {
      uploads.push({ userId, filename });
      return { jobId: `job${++n}` };
    },
    ...over,
  };
  return { deps, uploads };
}

test("addressToken: local-part, lowercased", () => {
  assert.equal(addressToken("AbC@in.pare.money"), "abc");
  assert.equal(addressToken("nope"), "nope");
});

test("unknown address -> rejected, nothing staged", async () => {
  const { deps, uploads } = stub();
  const out = await handleInboundEmail({ to: "bad@in.pare.money", pdfs: [{ filename: "s.pdf", bytes: PDF }] }, deps);
  assert.deepEqual(out, { action: "rejected", reason: "unknown-address" });
  assert.equal(uploads.length, 0); // never touched storage
});

test("known user, no attachment -> rejected", async () => {
  const { deps, uploads } = stub();
  const out = await handleInboundEmail({ to: "good@in.pare.money", pdfs: [] }, deps);
  assert.deepEqual(out, { action: "rejected", reason: "no-pdf" });
  assert.equal(uploads.length, 0);
});

test("known user, valid PDF -> accepted + staged for the right user", async () => {
  const { deps, uploads } = stub();
  const out = await handleInboundEmail({ to: "good@in.pare.money", pdfs: [{ filename: "may.pdf", bytes: PDF }] }, deps);
  assert.equal(out.action, "accepted");
  if (out.action === "accepted") {
    assert.equal(out.userId, "u1");
    assert.deepEqual(out.jobs, [{ filename: "may.pdf", jobId: "job1" }]);
  }
  assert.deepEqual(uploads, [{ userId: "u1", filename: "may.pdf" }]);
});

test("a .pdf-named non-PDF never enters the pipeline", async () => {
  const { deps, uploads } = stub();
  const out = await handleInboundEmail({ to: "good@in.pare.money", pdfs: [{ filename: "fake.pdf", bytes: NOT_PDF }] }, deps);
  assert.deepEqual(out, { action: "rejected", reason: "no-valid-pdf" });
  assert.equal(uploads.length, 0);
});

test("over plan limit -> over-limit, nothing staged", async () => {
  const { deps, uploads } = stub({
    enforceUpload: async () => ({ allowed: false, reason: "monthly limit reached" }),
  });
  const out = await handleInboundEmail({ to: "good@in.pare.money", pdfs: [{ filename: "s.pdf", bytes: PDF }] }, deps);
  assert.deepEqual(out, { action: "over-limit", userId: "u1" });
  assert.equal(uploads.length, 0);
});

test("multiple PDFs -> one job each", async () => {
  const { deps, uploads } = stub();
  const out = await handleInboundEmail(
    { to: "good@in.pare.money", pdfs: [{ filename: "a.pdf", bytes: PDF }, { filename: "b.pdf", bytes: PDF }] },
    deps
  );
  assert.equal(out.action, "accepted");
  if (out.action === "accepted") assert.equal(out.jobs.length, 2);
  assert.equal(uploads.length, 2);
});
