/**
 * Unit tests for the stdio-server liveness heartbeat (mcp/heartbeat.ts) — the
 * self-host source of the /profile CLAUDE indicator. Runs in the test:repo
 * suite; PARE_DATA_DIR is re-pointed per-case (the module resolves it lazily),
 * so nothing touches the real data/ directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { touchMcpHeartbeat, readMcpHeartbeat } from "./heartbeat";

function withTempDataDir(fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pare-heartbeat-"));
  const prev = process.env.PARE_DATA_DIR;
  process.env.PARE_DATA_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.PARE_DATA_DIR;
    else process.env.PARE_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("no heartbeat file reads as null (never connected)", () => {
  withTempDataDir(() => {
    assert.equal(readMcpHeartbeat(), null);
  });
});

test("touch → read round-trips the timestamp", () => {
  withTempDataDir(() => {
    const now = new Date("2026-07-25T12:34:56.000Z");
    touchMcpHeartbeat(now);
    assert.equal(readMcpHeartbeat(), now.toISOString());
  });
});

test("a later touch overwrites the previous timestamp", () => {
  withTempDataDir(() => {
    touchMcpHeartbeat(new Date("2026-07-25T10:00:00.000Z"));
    const later = new Date("2026-07-25T11:00:00.000Z");
    touchMcpHeartbeat(later);
    assert.equal(readMcpHeartbeat(), later.toISOString());
  });
});

test("touch creates the data dir when missing", () => {
  withTempDataDir((dir) => {
    const nested = path.join(dir, "nested-data");
    process.env.PARE_DATA_DIR = nested;
    touchMcpHeartbeat(new Date("2026-07-25T09:00:00.000Z"));
    assert.ok(fs.existsSync(path.join(nested, "mcp-heartbeat.json")));
    assert.equal(readMcpHeartbeat(), "2026-07-25T09:00:00.000Z");
  });
});

test("corrupt or wrong-shape heartbeat file reads as null", () => {
  withTempDataDir((dir) => {
    const file = path.join(dir, "mcp-heartbeat.json");
    fs.writeFileSync(file, "not json{{");
    assert.equal(readMcpHeartbeat(), null);
    fs.writeFileSync(file, JSON.stringify({ lastSeenAt: 12345 }));
    assert.equal(readMcpHeartbeat(), null);
  });
});
