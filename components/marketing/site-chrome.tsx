import Link from "next/link";

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
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
  { href: "/terms", label: "Terms" },
] as const;

export function MarketingHeader() {
  return (
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
