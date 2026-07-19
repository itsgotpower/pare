import { marked } from "marked";
import { RAW_POSTS } from "./blog-content.generated";

// Dead-simple, no-CMS blog. Articles are Markdown + YAML frontmatter in
// content/blog/*.md; scripts/gen-blog-content.mjs inlines them into
// blog-content.generated.ts at build time. We read from that bundled module
// (NOT node:fs) so the pages render on Cloudflare Workers, which have no runtime
// filesystem — see the generator's header for the full reasoning. Rendering
// (marked / TOC / reading time) is pure computation and safe to run either at
// build (prerender) or in the Worker (regeneration).

const SITE_ORIGIN = "https://pare.money";
const WORDS_PER_MINUTE = 220;
export const DEFAULT_AUTHOR = "The Pare team";

export interface FaqItem {
  q: string;
  a: string;
}

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // YYYY-MM-DD
  updatedAt: string; // YYYY-MM-DD; falls back to publishedAt when unset
  author: string;
  keywords: string[];
  canonical: string;
  ogImage?: string;
  readingMinutes: number;
  // Optional GEO/UX surfaces, authored in frontmatter:
  tldr: string[]; // key-takeaway bullets shown up top + reused in structured data
  faq: FaqItem[]; // question/answer pairs → FAQPage JSON-LD
  howto: boolean; // when true, the post's first Stepper is emitted as HowTo JSON-LD
}

export interface TocItem {
  id: string;
  text: string;
  depth: number; // 2 for H2, 3 for H3
}

// A rendered post is an ordered list of blocks so interactive widgets can be
// interleaved with prose. Prose blocks are marked-rendered HTML strings (injected
// via dangerouslySetInnerHTML, as before); widget blocks name a React component +
// its props, mounted client-side by components/blog/blog-widget.tsx. See
// splitBlocks() for the `:::pare-widget` authoring convention.
export type PostBlock =
  | { kind: "prose"; html: string }
  | { kind: "widget"; component: string; props: unknown };

export interface Post extends PostMeta {
  blocks: PostBlock[];
  toc: TocItem[];
}

// lower-case, hyphen-separated, alphanumerics only — used both for heading anchor
// ids and the TOC links, so the two always agree.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readingMinutes(markdown: string): number {
  // Don't count widget-spec JSON as prose words.
  const words = stripWidgetBlocks(markdown).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function toMeta(slug: string, data: Record<string, unknown>, markdown: string): PostMeta {
  const publishedAt = String(data.publishedAt ?? "");
  const faq = Array.isArray(data.faq)
    ? data.faq
        .map((f) => ({ q: String((f as FaqItem)?.q ?? ""), a: String((f as FaqItem)?.a ?? "") }))
        .filter((f) => f.q && f.a)
    : [];
  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    publishedAt,
    updatedAt: data.updatedAt ? String(data.updatedAt) : publishedAt,
    author: data.author ? String(data.author) : DEFAULT_AUTHOR,
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
    canonical: String(data.canonical ?? `${SITE_ORIGIN}/blog/${slug}`),
    ogImage: data.ogImage ? String(data.ogImage) : undefined,
    readingMinutes: readingMinutes(markdown),
    tldr: Array.isArray(data.tldr) ? data.tldr.map(String).filter(Boolean) : [],
    faq,
    howto: data.howto === true,
  };
}

// H2/H3 headings only — H1 is the page title, rendered outside the prose. Widget
// blocks are stripped first so a `##` inside a widget's JSON can't leak into the TOC.
function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of stripWidgetBlocks(markdown).split("\n")) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const text = m[2].trim();
      items.push({ depth: m[1].length, text, id: slugify(text) });
    }
  }
  return items;
}

// Content is authored by us (trusted), so rendering to an HTML string and adding
// anchor ids with a regex is safe and avoids pulling in a heavier renderer.
function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true }) as string;
  return html.replace(/<(h[23])>(.*?)<\/\1>/g, (_full, tag: string, inner: string) => {
    const plain = inner.replace(/<[^>]+>/g, "");
    const id = slugify(plain);
    // Real anchor link (server-rendered, so it's crawlable and shareable). It's
    // visually hidden until the heading is hovered/focused — see `.heading-anchor`
    // in globals.css — to keep the brutalist headings clean.
    const anchor = `<a href="#${id}" class="heading-anchor" aria-label="Link to this section">#</a>`;
    return `<${tag} id="${id}">${anchor}${inner}</${tag}>`;
  });
}

// Widget authoring convention. A block delimited on its own lines:
//
//   :::pare-widget
//   { "component": "BarCompare", "props": { ... } }
//   :::
//
// We split the RAW markdown on these before handing prose to marked, so the
// delimiter can never be mangled into a <pre><code> block. The body is JSON:
// `component` (required) names a registered widget; `props` is passed through.
const WIDGET_BLOCK = /^:::pare-widget[ \t]*\r?\n([\s\S]*?)\r?\n:::[ \t]*$/gm;

function stripWidgetBlocks(markdown: string): string {
  return markdown.replace(WIDGET_BLOCK, "");
}

// Slice raw markdown into an ordered [prose, widget, prose, …] block list. A bad
// widget spec throws (naming the slug) so a typo fails the build loudly instead of
// silently dropping the module.
export function splitBlocks(markdown: string, slug: string): PostBlock[] {
  const blocks: PostBlock[] = [];
  const pushProse = (raw: string) => {
    if (raw.trim()) blocks.push({ kind: "prose", html: renderMarkdown(raw) });
  };
  let lastIndex = 0;
  WIDGET_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIDGET_BLOCK.exec(markdown)) !== null) {
    pushProse(markdown.slice(lastIndex, m.index));
    const body = m[1].trim();
    let spec: { component?: unknown; props?: unknown };
    try {
      spec = JSON.parse(body);
    } catch (err) {
      throw new Error(
        `Blog post "${slug}": invalid JSON in a :::pare-widget block — ${(err as Error).message}\n${body}`
      );
    }
    if (!spec || typeof spec.component !== "string") {
      throw new Error(
        `Blog post "${slug}": a :::pare-widget block needs a string "component" field.`
      );
    }
    blocks.push({ kind: "widget", component: spec.component, props: spec.props ?? {} });
    lastIndex = m.index + m[0].length;
  }
  pushProse(markdown.slice(lastIndex));
  return blocks;
}

export function getAllSlugs(): string[] {
  return RAW_POSTS.map((p) => p.slug);
}

export function getAllPostMeta(): PostMeta[] {
  return RAW_POSTS.map((p) => toMeta(p.slug, p.data, p.content)).sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt)
  );
}

export function getPost(slug: string): Post | null {
  const raw = RAW_POSTS.find((p) => p.slug === slug);
  if (!raw) return null;
  const meta = toMeta(raw.slug, raw.data, raw.content);
  return { ...meta, blocks: splitBlocks(raw.content, raw.slug), toc: extractToc(raw.content) };
}

// "Read next" suggestions: other posts ranked by shared keywords (the corpus is
// tightly themed, so keyword overlap is a good proxy for relatedness), tie-broken
// by recency. Falls back to most-recent when nothing overlaps.
export function getRelatedPosts(slug: string, limit = 2): PostMeta[] {
  const all = getAllPostMeta();
  const current = all.find((p) => p.slug === slug);
  if (!current) return [];
  const mine = new Set(current.keywords.map((k) => k.toLowerCase()));
  return all
    .filter((p) => p.slug !== slug)
    .map((p) => ({
      post: p,
      overlap: p.keywords.filter((k) => mine.has(k.toLowerCase())).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.post.publishedAt.localeCompare(a.post.publishedAt))
    .slice(0, limit)
    .map((x) => x.post);
}
