import { test } from "node:test";
import assert from "node:assert/strict";
import { hasFeature } from "./enforce";

// hasFeature is the pure entitlement decision (mirrors checkStatementLimit). It
// reads PARE_CLOUD via cloudEnabled(), so toggle it per case and restore after.
function withCloud(on: boolean, fn: () => void) {
  const saved = process.env.PARE_CLOUD;
  try {
    if (on) process.env.PARE_CLOUD = "1";
    else delete process.env.PARE_CLOUD;
    fn();
  } finally {
    if (saved === undefined) delete process.env.PARE_CLOUD;
    else process.env.PARE_CLOUD = saved;
  }
}

test("cloud OFF: every feature is allowed (open-source core / self-host keeps everything)", () => {
  withCloud(false, () => {
    assert.equal(hasFeature("free", "email_ingest"), true);
    assert.equal(hasFeature("free", "llm_autocoverage"), true);
    assert.equal(hasFeature("pro", "email_ingest"), true);
  });
});

test("cloud ON: the free plan unlocks no premium features", () => {
  withCloud(true, () => {
    assert.equal(hasFeature("free", "email_ingest"), false);
    assert.equal(hasFeature("free", "llm_autocoverage"), false);
    assert.equal(hasFeature("free", "simplefin"), false);
  });
});

test("cloud ON: the pro plan unlocks the premium features", () => {
  withCloud(true, () => {
    assert.equal(hasFeature("pro", "email_ingest"), true);
    assert.equal(hasFeature("pro", "llm_autocoverage"), true);
    assert.equal(hasFeature("pro", "simplefin"), true);
  });
});

test("cloud ON: an unknown plan id falls back to the default (free) entitlements", () => {
  withCloud(true, () => {
    // @ts-expect-error — exercising the runtime `?? PLANS[DEFAULT_PLAN]` fallback
    assert.equal(hasFeature("enterprise", "email_ingest"), false);
  });
});
