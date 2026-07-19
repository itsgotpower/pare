import type { Post } from "./blog";

// Structured data for a blog post. Search engines and AI answer engines
// (Perplexity, Google AI Overviews, ChatGPT search) read schema.org JSON-LD to
// decide what a page asserts and who stands behind it — prose alone makes them
// guess. We emit a single @graph so the objects can cross-reference by @id.
//
// Pure module (no React/DOM); the page serializes the result into a
// <script type="application/ld+json">.

const ORIGIN = "https://pare.money";
const PUBLISHER = {
  "@type": "Organization",
  "@id": `${ORIGIN}/#org`,
  name: "Pare",
  url: ORIGIN,
  logo: { "@type": "ImageObject", url: `${ORIGIN}/icon-512.png` },
};

interface StepperStep {
  title?: unknown;
  body?: unknown;
}

// Pull the first Stepper widget's steps so a how-to post's interactive module and
// its HowTo structured data come from one source of truth.
function firstStepperSteps(post: Post): { title: string; body: string }[] {
  for (const block of post.blocks) {
    if (block.kind === "widget" && block.component === "Stepper") {
      const steps = (block.props as { steps?: StepperStep[] })?.steps;
      if (Array.isArray(steps)) {
        return steps.map((s) => ({ title: String(s?.title ?? ""), body: String(s?.body ?? "") }));
      }
    }
  }
  return [];
}

const iso = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toISOString() : undefined);

export function buildStructuredData(post: Post): object {
  const image = post.ogImage ?? `${post.canonical}/opengraph-image`;

  const article = {
    "@type": "BlogPosting",
    "@id": `${post.canonical}/#article`,
    headline: post.title,
    description: post.description,
    datePublished: iso(post.publishedAt),
    dateModified: iso(post.updatedAt),
    author: { "@type": "Organization", name: post.author, url: ORIGIN },
    publisher: PUBLISHER,
    mainEntityOfPage: { "@type": "WebPage", "@id": post.canonical },
    url: post.canonical,
    image,
    keywords: post.keywords.join(", "),
    articleSection: "Personal finance",
    inLanguage: "en",
  };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${ORIGIN}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: post.canonical },
    ],
  };

  const graph: object[] = [article, breadcrumb];

  if (post.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${post.canonical}/#faq`,
      mainEntity: post.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  const steps = post.howto ? firstStepperSteps(post) : [];
  if (steps.length > 0) {
    graph.push({
      "@type": "HowTo",
      "@id": `${post.canonical}/#howto`,
      name: post.title,
      description: post.description,
      step: steps.map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.title,
        text: s.body,
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
