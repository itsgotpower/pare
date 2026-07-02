import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllSlugs, getPost } from "@/lib/blog";

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
    alternates: { canonical: post.canonical },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: post.canonical,
      publishedTime: post.publishedAt || undefined,
      images: post.ogImage ? [post.ogImage] : undefined,
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

  const showToc = post.toc.filter((t) => t.depth === 2).length >= 4;

  return (
    <div className="min-h-full flex flex-col bg-background">
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-14 border-b border-border">
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
        <div className="flex items-center gap-3 mt-4">
          <span className={labelClass}>{formatDate(post.publishedAt)}</span>
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
          <span className={labelClass}>{post.readingMinutes} min read</span>
        </div>

        {showToc && (
          <nav
            aria-label="On this page"
            className="mt-8 border border-border bg-card p-4"
          >
            <p className={`${labelClass} mb-2`}>On this page</p>
            <ul className="space-y-1.5">
              {post.toc
                .filter((t) => t.depth === 2)
                .map((t) => (
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

        <article
          className="prose-pare mt-8"
          dangerouslySetInnerHTML={{ __html: post.html }}
        />

        {/* Soft CTA — no hard sell. On the hosted waitlist build "/" is the signup. */}
        <section className="border border-border bg-card p-5 mt-12">
          <p className={labelClass}>Early access</p>
          <p className="text-sm leading-relaxed text-foreground/90 mt-2">
            Pare is a local-first personal-finance app that reads your statements instead of your
            bank login. It&apos;s in early access — if any of this resonates, put your email on the
            list and we&apos;ll let you know when it&apos;s your turn.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 mt-4 font-mono text-[11px] tracking-widest uppercase border border-border bg-background px-4 h-10 text-foreground hover:bg-muted transition-colors"
          >
            Join the waitlist →
          </Link>
        </section>
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
