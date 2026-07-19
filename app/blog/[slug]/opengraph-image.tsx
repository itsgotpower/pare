import { ImageResponse } from "next/og";
import { getAllSlugs, getPost } from "@/lib/blog";

// Per-post social/share card. What shows in a Slack/X/LinkedIn unfurl, a Google
// SERP thumbnail, and increasingly an LLM citation chip — a blank or generic image
// quietly caps click-through on every share. Rendered in the brutalist style
// (paper ground, 1px-ish frame, one earth-tone accent). Uses next/og's built-in
// font for now; upgrading to JetBrains Mono means fetching the ttf at render time
// (works, but adds a cross-deploy-target dependency), a deliberate follow-up.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Pare blog post";

// Prerender a card for every known post at build (in Node); unknown slugs still
// render on demand and fall back to the generic wordmark card.
export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

const PAPER = "#efece3";
const INK = "#1c1a17";
const MUTED = "#7a746b";
const SAGE = "#8a9b66";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  const title = post?.title ?? "Pare — local-first personal finance";
  const label = (post?.keywords[0] ?? "Personal finance").toUpperCase();
  const minutes = post ? `${post.readingMinutes} MIN READ` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          padding: 44,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            border: `3px solid ${INK}`,
            padding: 56,
          }}
        >
          {/* Top row: wordmark + section label */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 6, color: INK }}>
              PARE
            </div>
            <div style={{ display: "flex", fontSize: 20, letterSpacing: 3, color: MUTED }}>{label}</div>
          </div>

          {/* Title + accent underline */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: title.length > 60 ? 58 : 68,
                fontWeight: 800,
                lineHeight: 1.08,
                color: INK,
                maxWidth: 980,
              }}
            >
              {title}
            </div>
            <div style={{ display: "flex", width: 120, height: 10, background: SAGE, marginTop: 32 }} />
          </div>

          {/* Bottom row: domain + reading time */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 2, color: INK }}>
              pare.money/blog
            </div>
            <div style={{ display: "flex", fontSize: 20, letterSpacing: 2, color: MUTED }}>{minutes}</div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
