import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

// Dead-simple, no-CMS blog. Articles are Markdown files with YAML frontmatter in
// content/blog/*.md. Everything here runs at BUILD time only: the /blog routes
// are statically generated (generateStaticParams + dynamicParams=false), so these
// node:fs reads happen during `next build` on the CI runner and are baked into the
// static output — the Cloudflare Worker never calls fs at request time.

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
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

function listSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
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
  return listSlugs();
}

export function getAllPostMeta(): PostMeta[] {
  return listSlugs()
    .map((slug) => {
      const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.md`), "utf8");
      const { data, content } = matter(raw);
      return toMeta(slug, data as Record<string, unknown>, content);
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getPost(slug: string): Post | null {
  const file = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  const { data, content } = matter(raw);
  const meta = toMeta(slug, data as Record<string, unknown>, content);
  return { ...meta, html: renderMarkdown(content), toc: extractToc(content) };
}
