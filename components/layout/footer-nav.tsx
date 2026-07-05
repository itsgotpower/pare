import Link from "next/link";
import { GithubMark } from "./github-mark";

export const REPO_URL = "https://github.com/itsgotpower/pare";

// The canonical marketing/legal nav — one source of truth so the footer reads
// the same on the landing page, the demo, and the in-app profile footer.
const LINKS: [string, string][] = [
  ["/about", "About"],
  ["/mcp", "MCP"],
  ["/how-it-works", "How it works"],
  ["/switch", "Switching"],
  ["/privacy", "Privacy"],
  ["/security", "Security"],
  ["/terms", "Terms"],
];

const itemCls =
  "font-mono text-[11px] tracking-wide uppercase text-muted-foreground hover:text-foreground transition-colors";

export function FooterNav({ className = "" }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-1.5 ${itemCls}`}
      >
        <GithubMark className="size-3.5" />
        GitHub
      </a>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className={itemCls}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
