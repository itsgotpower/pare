// Guards for the chunk-recovery cache wipe — the failure modes here are data
// loss: deleting the share-target intake cache loses statements the user
// shared but /upload hasn't consumed, and wiping while offline destroys the
// SW's offline read-through with no way to refill it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isChunkLoadError, recoverFromChunkError } from "./chunk-recovery";

type Ctx = { deleted: string[]; reloaded: () => number };

function setup({ online = true, cacheNames = [] as string[] } = {}): Ctx {
  const deleted: string[] = [];
  let reloads = 0;
  const store = new Map<string, string>();
  const fakeCaches = {
    keys: async () => cacheNames,
    delete: async (k: string) => {
      deleted.push(k);
      return true;
    },
  };
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: {
      reload: () => {
        reloads++;
      },
    },
    caches: fakeCaches,
  };
  (globalThis as Record<string, unknown>).caches = fakeCaches;
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: online },
    configurable: true,
  });
  return { deleted, reloaded: () => reloads };
}

test("offline: declines without touching caches or reloading", async () => {
  const ctx = setup({
    online: false,
    cacheNames: ["pare-static-v2-abc", "pare-share-intake"],
  });
  assert.equal(await recoverFromChunkError(), false);
  assert.deepEqual(ctx.deleted, []);
  assert.equal(ctx.reloaded(), 0);
});

test("wipes only pare-* caches, never the share intake", async () => {
  const ctx = setup({
    cacheNames: [
      "pare-static-v2-abc",
      "pare-data-v2-abc",
      "pare-share-intake",
      "some-other-origin-cache",
    ],
  });
  assert.equal(await recoverFromChunkError(), true);
  assert.deepEqual(ctx.deleted.sort(), ["pare-data-v2-abc", "pare-static-v2-abc"]);
  assert.equal(ctx.reloaded(), 1);
});

test("loop guard: a second recovery within 10s declines", async () => {
  const ctx = setup({ cacheNames: ["pare-static-v2-abc"] });
  assert.equal(await recoverFromChunkError(), true);
  assert.equal(await recoverFromChunkError(), false);
  assert.equal(ctx.reloaded(), 1);
});

test("isChunkLoadError matches deploy-mismatch shapes, not ordinary errors", () => {
  assert.equal(
    isChunkLoadError(Object.assign(new Error("boom"), { name: "ChunkLoadError" })),
    true
  );
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed")), true);
  assert.equal(
    isChunkLoadError(new TypeError("error loading dynamically imported module")),
    true
  );
  assert.equal(isChunkLoadError(new Error("fetch failed")), false);
  assert.equal(isChunkLoadError(undefined), false);
});
