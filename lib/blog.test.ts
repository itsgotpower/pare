import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBlocks, getPost, getAllSlugs, getRelatedPosts, type PostBlock } from "./blog";
import { buildStructuredData } from "./blog-jsonld";

const widget = (b: PostBlock) => (b.kind === "widget" ? b : null);

test("splitBlocks: prose only → a single prose block", () => {
  const blocks = splitBlocks("# Hi\n\nSome **prose** here.", "t");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "prose");
  assert.match((blocks[0] as { html: string }).html, /<strong>prose<\/strong>/);
});

test("splitBlocks: a widget between paragraphs yields prose / widget / prose", () => {
  const md = [
    "Intro paragraph.",
    "",
    ":::pare-widget",
    '{ "component": "BarCompare", "props": { "series": [{ "label": "A", "value": 1 }] } }',
    ":::",
    "",
    "Outro paragraph.",
  ].join("\n");

  const blocks = splitBlocks(md, "t");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["prose", "widget", "prose"]
  );
  const w = widget(blocks[1])!;
  assert.equal(w.component, "BarCompare");
  assert.deepEqual(w.props, { series: [{ label: "A", value: 1 }] });
});

test("splitBlocks: leading widget (no prose before it) skips the empty prose block", () => {
  const md = [':::pare-widget', '{ "component": "Donut" }', ':::', "", "After."].join("\n");
  const blocks = splitBlocks(md, "t");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["widget", "prose"]
  );
  // Missing props defaults to {} so the widget always receives an object.
  assert.deepEqual(widget(blocks[0])!.props, {});
});

test("splitBlocks: two widgets back to back stay distinct", () => {
  const md = [
    ":::pare-widget",
    '{ "component": "Donut" }',
    ":::",
    ":::pare-widget",
    '{ "component": "Stepper" }',
    ":::",
  ].join("\n");
  const blocks = splitBlocks(md, "t");
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["widget", "widget"]
  );
});

test("splitBlocks: malformed JSON throws and names the slug", () => {
  const md = [":::pare-widget", "{ not valid json }", ":::"].join("\n");
  assert.throws(() => splitBlocks(md, "my-post"), /my-post.*:::pare-widget/s);
});

test("splitBlocks: a widget missing `component` throws", () => {
  const md = [":::pare-widget", '{ "props": {} }', ":::"].join("\n");
  assert.throws(() => splitBlocks(md, "my-post"), /component/);
});

test("getPost: bundled posts parse into blocks; any widget names a registered component", () => {
  const REGISTERED = new Set(["BarCompare", "Donut", "Stepper"]);
  const slugs = getAllSlugs();
  assert.ok(slugs.length > 0, "expected at least one bundled post");
  for (const slug of slugs) {
    const post = getPost(slug)!;
    assert.ok(post.blocks.length > 0, `${slug} produced no blocks`);
    assert.ok(post.blocks.some((b) => b.kind === "prose"), `${slug} has no prose`);
    for (const b of post.blocks) {
      if (b.kind === "widget") {
        assert.ok(REGISTERED.has(b.component), `${slug} has unregistered widget ${b.component}`);
      }
    }
  }
});

test("getRelatedPosts: returns other posts (never the current one)", () => {
  const [slug] = getAllSlugs();
  const related = getRelatedPosts(slug, 2);
  assert.ok(related.length > 0, "expected related posts");
  assert.ok(!related.some((r) => r.slug === slug), "must not include the current post");
});

test("buildStructuredData: always emits BlogPosting + BreadcrumbList", () => {
  for (const slug of getAllSlugs()) {
    const post = getPost(slug)!;
    const graph = (buildStructuredData(post) as { "@graph": { "@type": string }[] })["@graph"];
    const types = graph.map((g) => g["@type"]);
    assert.ok(types.includes("BlogPosting"), `${slug} missing BlogPosting`);
    assert.ok(types.includes("BreadcrumbList"), `${slug} missing BreadcrumbList`);
    // HowTo only when the post opts in AND has a Stepper.
    if (types.includes("HowTo")) assert.equal(post.howto, true, `${slug} emitted HowTo without opt-in`);
  }
});
