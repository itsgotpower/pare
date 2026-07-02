import { test } from "node:test";
import assert from "node:assert/strict";
import { DoRepoClient } from "./do-repo-client";
import { REPO_CATALOGUE, type AnyRepoCall } from "./repo-rpc";

// The forwarders are GENERATED from REPO_CATALOGUE, and the catalogue is
// compile-checked against the Repo interface (RepoCatalogue in repo-rpc.ts) — so
// coverage is a type error, not a test. What the types can't pin is the RUNTIME
// half of the generation: that every catalogued method actually exists on the
// client, ships the exact {namespace, method, args} envelope (positional args in
// order), and that the per-method write flag drives batch() buffering the same
// way the old hand-written WRITE_METHODS set did. That's what this file pins.

test("DoRepoClient: every catalogued method exists and forwards its envelope verbatim", async () => {
  const sent: AnyRepoCall[] = [];
  const client = new DoRepoClient(async (call) => {
    sent.push(call);
    return undefined;
  });

  const surface = client as unknown as Record<
    string,
    Record<string, (...args: unknown[]) => Promise<unknown>>
  >;
  for (const [namespace, methods] of Object.entries(REPO_CATALOGUE)) {
    for (const method of Object.keys(methods)) {
      assert.equal(
        typeof surface[namespace]?.[method],
        "function",
        `client is missing ${namespace}.${method}`
      );
      // Multi-arg marshalling: args must arrive as the envelope's array, in order.
      await surface[namespace][method]("a", 2, { nested: true });
      assert.deepEqual(sent.pop(), { namespace, method, args: ["a", 2, { nested: true }] });
    }
  }
});

test("DoRepoClient: batch() buffers catalogue-flagged writes, reads pass through", async () => {
  const sent: AnyRepoCall[] = [];
  const client = new DoRepoClient(async (call) => {
    sent.push(call);
    return call.namespace === "__batch__" ? "batch-result" : [];
  });

  const result = await client.batch(async () => {
    await client.categories.addRule("Groceries", "SAFEWAY"); // write → buffered
    await client.categories.listRules(); // read → direct, even mid-batch
    await client.transactions.insertMany([]); // write → buffered
  });

  // One direct read, then ONE __batch__ envelope carrying both writes in order,
  // with returnIndex 0 (the first write's result becomes the batch's return).
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { namespace: "categories", method: "listRules", args: [] });
  assert.deepEqual(sent[1], {
    namespace: "__batch__",
    method: "exec",
    args: [
      [
        { namespace: "categories", method: "addRule", args: ["Groceries", "SAFEWAY"] },
        { namespace: "transactions", method: "insertMany", args: [[]] },
      ],
      0,
    ],
  });
  assert.equal(result, "batch-result");
});
