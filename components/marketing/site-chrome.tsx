import Link from "next/link";
import { Wordmark } from "@/components/layout/wordmark";
import { GithubMark } from "@/components/layout/github-mark";
import { REPO_URL } from "@/components/layout/footer-nav";

/* Shared chrome for the marketing subpages linked from the landing footer
   (/about, /mcp, /how-it-works, /switch, /privacy, /security, /terms).
   These pages each used to inline their own header/footer and the footer
   link sets drifted — every page linked a different arbitrary subset. One
   component, one link list, no drift. The landing page (app/page.tsx) and
   blog keep their own chrome: the landing footer is the full site map and
   the blog nav is contextual (← All posts). */

const FOOTER_LINKS = [
  { href: "/about", label: "About" },
  { href: "/mcp", label: "MCP for Claude" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/switch", label: "Switch" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
  { href: "/terms", label: "Terms" },
] as const;

export function MarketingHeader() {
  return (
    <header className="shrink-0 flex items-center justify-between px-5 md:px-8 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-border">
      <Wordmark href="/" className="font-mono text-sm font-bold tracking-tight" />
      <div className="flex items-center gap-4 md:gap-5">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          <GithubMark className="size-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
        <Link
          href="/login"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in
        </Link>
        <Link
          href="/login?signup=1"
          className="font-mono text-[10px] md:text-xs tracking-widest uppercase border border-input px-3 py-1.5 hover:bg-accent transition-colors"
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}

export function MarketingFooter({ current }: { current?: string }) {
  return (
    <footer className="shrink-0 border-t border-border px-5 md:px-8 py-4 flex items-center justify-between gap-4">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {FOOTER_LINKS.map(({ href, label }) =>
          href === current ? (
            <span
              key={href}
              aria-current="page"
              className="font-mono text-[11px] tracking-wide uppercase text-foreground"
            >
              {label}
            </span>
          ) : (
            <Link
              key={href}
              href={href}
              className="font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              {label}
            </Link>
          ),
        )}
      </nav>
      <Link
        href="/"
        className="shrink-0 font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors"
      >
        pare
      </Link>
    </footer>
  );
}
