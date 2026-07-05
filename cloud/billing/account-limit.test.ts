import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAccountLimit } from "./enforce";

// checkAccountLimit is deliberately PURE — no PARE_CLOUD probe (see the note in
// enforce.ts: process.env isn't reliably readable inside a Cloudflare queue()
// invocation, where this check runs). The "cloud off ⇒ allow" property lives
// upstream: the producer only stamps a planId onto the parse-job message when
// the cloud layer is enabled, and the consumer skips the check without one. So
// unlike entitlements.test.ts there is no withCloud() toggling here — the
// decision must hold regardless of env.

test("free: uploading a statement for a NEW source with 1 account already → blocked", () => {
  const r = checkAccountLimit({
    planId: "free",
    existingSources: ["cibc_visa"],
    newSource: "amex",
  });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "Free plan includes 1 account. Upgrade for more.");
});

test("free: re-uploading for the SAME source is always allowed (cap only blocks new accounts)", () => {
  const r = checkAccountLimit({
    planId: "free",
    existingSources: ["cibc_visa"],
    newSource: "cibc_visa",
  });
  assert.equal(r.allowed, true);
});

test("free: the first account is allowed", () => {
  const r = checkAccountLimit({ planId: "free", existingSources: [], newSource: "amex" });
  assert.equal(r.allowed, true);
});

test("pro (Plus): a second account is allowed, a third is blocked", () => {
  assert.equal(
    checkAccountLimit({
      planId: "pro",
      existingSources: ["cibc_visa"],
      newSource: "amex",
    }).allowed,
    true
  );

  const blocked = checkAccountLimit({
    planId: "pro",
    existingSources: ["cibc_visa", "amex"],
    newSource: "td_card",
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "Plus plan includes 2 accounts. Upgrade for more.");
});

test("manual cash rows are not an account — 'manual' never counts against the cap", () => {
  // Only manual rows so far: a free user's first real account is still allowed.
  assert.equal(
    checkAccountLimit({ planId: "free", existingSources: ["manual"], newSource: "amex" })
      .allowed,
    true
  );
  // manual + one real account: the free cap is genuinely used up by the real one.
  const r = checkAccountLimit({
    planId: "free",
    existingSources: ["manual", "cibc_visa"],
    newSource: "amex",
  });
  assert.equal(r.allowed, false);
});

test("duplicate source values collapse — the cap counts DISTINCT accounts", () => {
  const r = checkAccountLimit({
    planId: "pro",
    existingSources: ["cibc_visa", "cibc_visa", "manual"],
    newSource: "amex",
  });
  assert.equal(r.allowed, true, "one distinct account used, so a second fits under the pro cap");
});

test("unknown plan id falls back to the default (free) caps", () => {
  const r = checkAccountLimit({
    planId: "enterprise",
    existingSources: ["cibc_visa"],
    newSource: "amex",
  });
  assert.equal(r.allowed, false);
  assert.match(r.reason ?? "", /Free plan includes 1 account/);
});
