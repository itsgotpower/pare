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

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // YYYY-MM-DD
  keywords: string[];
  canonical: string;
  ogImage?: string;
  readingMinutes: number;
}

export interface TocItem {
  id: string;
  text: string;
  depth: number; // 2 for H2, 3 for H3
}

export interface Post extends PostMeta {
  html: string;
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
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function toMeta(slug: string, data: Record<string, unknown>, markdown: string): PostMeta {
  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    publishedAt: String(data.publishedAt ?? ""),
    keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : [],
    canonical: String(data.canonical ?? `${SITE_ORIGIN}/blog/${slug}`),
    ogImage: data.ogImage ? String(data.ogImage) : undefined,
    readingMinutes: readingMinutes(markdown),
  };
}

// H2/H3 headings only — H1 is the page title, rendered outside the prose.
function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of markdown.split("\n")) {
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
    return `<${tag} id="${slugify(plain)}">${inner}</${tag}>`;
  });
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
  return { ...meta, html: renderMarkdown(raw.content), toc: extractToc(raw.content) };
}
