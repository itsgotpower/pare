import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllSlugs, getPost, getRelatedPosts } from "@/lib/blog";
import { BlogWidget } from "@/components/blog/blog-widget";
import { BlogTocRail } from "@/components/blog/blog-toc-rail";
import { buildStructuredData } from "@/lib/blog-jsonld";

// Public article page. Content comes from a bundled module (lib/blog.ts →
// blog-content.generated.ts), so no filesystem is touched at build OR runtime.
// generateStaticParams prerenders every known slug; we intentionally keep
// dynamicParams at its default (true) and do NOT force-static, because the
// Cloudflare waitlist deploy has no R2 incremental cache — so these routes are
// rendered on demand in the Worker rather than served from a prerender cache.
// getPost() returns notFound() for any slug that isn't in the bundle, so unknown
// paths still 404.

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — PARE`,
    description: post.description,
    keywords: post.keywords,
    authors: [{ name: post.author }],
    alternates: { canonical: post.canonical },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: post.canonical,
      publishedTime: post.publishedAt || undefined,
      modifiedTime: post.updatedAt || undefined,
      authors: [post.author],
      // When post.ogImage is unset, Next auto-appends the file-based
      // opengraph-image.tsx card here (and on the twitter card below).
      images: post.ogImage ? [post.ogImage] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const h2s = post.toc.filter((t) => t.depth === 2);
  const showToc = h2s.length >= 4;
  const related = getRelatedPosts(post.slug, 2);
  const updated = post.updatedAt && post.updatedAt !== post.publishedAt ? post.updatedAt : "";

  return (
    <div className="min-h-full flex flex-col bg-background">
      {/* Structured data: BlogPosting + BreadcrumbList (+ FAQPage/HowTo when the
          post has them). Read by search + AI answer engines. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildStructuredData(post)) }}
      />
      {showToc && <BlogTocRail items={h2s.map((t) => ({ id: t.id, text: t.text }))} />}
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-border">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          PARE
        </Link>
        <Link
          href="/blog"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          ← All posts
        </Link>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>Blog</p>
        <h1 className="font-mono text-2xl md:text-3xl font-bold tracking-tight mt-2 leading-tight">
          {post.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-4">
          <span className={labelClass}>{post.author}</span>
          <span className="text-muted-foreground/40" aria-hidden="true">·</span>
          <time className={labelClass} dateTime={post.publishedAt}>
            {formatDate(post.publishedAt)}
          </time>
          {updated && (
            <>
              <span className="text-muted-foreground/40" aria-hidden="true">·</span>
              <span className={labelClass}>
                Updated <time dateTime={updated}>{formatDate(updated)}</time>
              </span>
            </>
          )}
          <span className="text-muted-foreground/40" aria-hidden="true">·</span>
          <span className={labelClass}>{post.readingMinutes} min read</span>
        </div>

        {/* The short version — an answer-first block for readers in a hurry and for
            AI answer engines that extract concise takeaways. */}
        {post.tldr.length > 0 && (
          <aside className="mt-8 border border-border bg-card p-5">
            <p className={`${labelClass} mb-3`}>The short version</p>
            <ul className="space-y-2">
              {post.tldr.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
                  <span aria-hidden="true" className="text-muted-foreground select-none">—</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {/* Inline TOC for narrow viewports; the scroll-spy rail replaces it on xl. */}
        {showToc && (
          <nav aria-label="On this page" className="mt-8 border border-border bg-card p-4 xl:hidden">
            <p className={`${labelClass} mb-2`}>On this page</p>
            <ul className="space-y-1.5">
              {h2s.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    {t.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* Prose blocks render as before (dangerouslySetInnerHTML); widget blocks
            mount interactive client components between them. See lib/blog.ts
            splitBlocks() for the :::pare-widget authoring convention. */}
        <article className="mt-8">
          {post.blocks.map((block, i) =>
            block.kind === "prose" ? (
              <div
                key={i}
                className="prose-pare"
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            ) : (
              <div key={i} className="my-8">
                <BlogWidget component={block.component} props={block.props} />
              </div>
            )
          )}
        </article>

        {/* FAQ — visible accordion that also backs the FAQPage structured data. */}
        {post.faq.length > 0 && (
          <section className="mt-12" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className={`${labelClass} mb-4`}>Common questions</h2>
            <div className="border border-border divide-y divide-border">
              {post.faq.map((f, i) => (
                <details key={i} className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 p-4 text-sm font-medium hover:bg-muted/50 transition-colors">
                    <span>{f.q}</span>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground shrink-0 transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="px-4 pb-4 text-sm leading-relaxed text-foreground/90">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* Soft CTA — no hard sell. */}
        <section className="border border-border bg-card p-5 mt-12">
          <p className={labelClass}>Try Pare</p>
          <p className="text-sm leading-relaxed text-foreground/90 mt-2">
            Pare is a local-first personal-finance app that reads your statements instead of your
            bank login. If any of this resonates, it&apos;s free to start — create an account and
            drop in your first statement.
          </p>
          <Link
            href="/login?signup=1"
            className="inline-flex items-center gap-2 mt-4 font-mono text-[11px] tracking-widest uppercase border border-border bg-background px-4 h-10 text-foreground hover:bg-muted transition-colors"
          >
            Sign up →
          </Link>
        </section>

        {/* Read next — internal linking + dwell time; ranked by shared keywords. */}
        {related.length > 0 && (
          <section className="mt-12" aria-labelledby="related-heading">
            <h2 id="related-heading" className={`${labelClass} mb-4`}>Read next</h2>
            <div className="grid gap-px bg-border border border-border sm:grid-cols-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/blog/${r.slug}`}
                  className="bg-card p-4 flex flex-col gap-2 hover:bg-muted transition-colors"
                >
                  <span className="font-mono text-sm font-bold tracking-tight leading-snug">
                    {r.title}
                  </span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{r.description}</span>
                  <span className={`${labelClass} mt-auto pt-1`}>{r.readingMinutes} min read →</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between">
        <Link
          href="/blog"
          className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          ← All posts
        </Link>
        <Link
          href="/about"
          className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          About Pare
        </Link>
      </footer>
    </div>
  );
}
