import Link from "next/link";
import type { Metadata } from "next";
import { getAllPostMeta } from "@/lib/blog";

// Public blog index. Crawlable signed-out (added to middleware PUBLIC_PATHS and,
// on the hosted waitlist build, WAITLIST_PUBLIC), so it renders its own chrome —
// the Sidebar hides itself on /blog (components/layout/navbar.tsx). Static: the
// post list is read from content/blog/*.md at build time.

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog — PARE",
  description:
    "Straight talk on leaving Mint, Monarch, and YNAB: privacy, data ownership, and the case for a personal-finance app that reads your statements instead of your bank login.",
  alternates: { canonical: "https://pare.money/blog" },
};

const labelClass = "font-mono text-[10px] tracking-widest uppercase text-muted-foreground";

function formatDate(iso: string): string {
  if (!iso) return "";
  // Parse as UTC-noon to avoid a timezone shift moving the date across midnight.
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function BlogIndexPage() {
  const posts = getAllPostMeta();

  return (
    <div className="min-h-full flex flex-col bg-background">
      <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-border">
        <Link href="/" className="font-mono text-sm font-bold tracking-tight">
          PARE
        </Link>
        <Link
          href="/"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </Link>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 md:px-8 py-10">
        <p className={labelClass}>Blog</p>
        <h1 className="font-mono text-3xl font-bold tracking-tight mt-2">
          Leaving your finance app? Read this first.
        </h1>
        <p className="text-sm leading-relaxed text-foreground/90 mt-6 max-w-2xl">
          Mint shut down. Monarch and YNAB want a subscription and a live line into your bank.
          These are honest write-ups on the trade-offs — what each tool does well, where Pare is
          different, and where it isn&apos;t. No hype, no affiliate spin.
        </p>

        <div className="mt-8 space-y-[1px] bg-border border border-border">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block bg-card p-5 hover:bg-muted transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className={labelClass}>{formatDate(post.publishedAt)}</span>
                <span className="text-muted-foreground/40" aria-hidden="true">
                  ·
                </span>
                <span className={labelClass}>{post.readingMinutes} min read</span>
              </div>
              <h2 className="font-mono text-base font-bold tracking-tight group-hover:underline underline-offset-2">
                {post.title}
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
                {post.description}
              </p>
            </Link>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed mt-8">
          Pare is a local-first personal-finance app that reads your bank and credit-card
          statements — no bank connection, no aggregator.{" "}
          <Link href="/about" className="link">
            More about Pare
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
