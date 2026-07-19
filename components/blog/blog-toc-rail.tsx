"use client";

import { useEffect, useState } from "react";

// Scroll-spy table of contents. Rendered by the page inside a sticky <aside> that
// sits in the article's left gutter on wide (xl) screens — an in-flow flex column,
// NOT a viewport-positioned fixed element, so it always aligns to the article even
// when the blog is nested in the app shell (sidebar + content). On smaller screens
// the page's inline TOC box is used instead and this isn't rendered.

interface TocEntry {
  id: string;
  text: string;
}

export function BlogTocRail({ items }: { items: TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    // Track which headings are above the fold-line (~25% from the top); the last
    // one still above it is the section the reader is currently in.
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // Prefer the topmost currently-visible heading; fall back to the last
        // heading scrolled past so the highlight never goes blank mid-section.
        const firstVisible = items.find((i) => visible.has(i.id));
        if (firstVisible) {
          setActiveId(firstVisible.id);
        } else {
          const scrolledPast = [...headings].reverse().find((h) => h.getBoundingClientRect().top < 120);
          if (scrolledPast) setActiveId(scrolledPast.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 4) return null;

  return (
    <nav aria-label="On this page">
      <p className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground mb-3">
        On this page
      </p>
      <ul className="space-y-2 border-l border-border">
        {items.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id} className="-ml-px">
              <a
                href={`#${t.id}`}
                className={`block border-l pl-3 text-xs leading-snug transition-colors ${
                  active
                    ? "border-foreground text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
