"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

// Client-side mount point for :::pare-widget blocks. The blog article is rendered
// by an async Server Component (app/blog/[slug]/page.tsx); under Next 16 you can't
// use next/dynamic({ ssr:false }) there, so the dynamic imports live here inside a
// "use client" boundary instead. Each widget becomes its own lazy chunk, loaded
// only when a post actually renders it — that keeps the shared blog bundle small
// (the Worker has a ~3 MiB gzip limit /demo already brushed up against).
//
// To add a widget: build it under ./widgets/, then register it below. The key is
// the `component` string authors put in the markdown block.

const skeleton = (h: number) => {
  const S = () => (
    <div style={{ height: h }} className="border border-border bg-card animate-pulse" aria-hidden />
  );
  return S;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry holds
// heterogeneous widget prop shapes; each widget validates/defaults its own props.
const REGISTRY: Record<string, ComponentType<any>> = {
  BarCompare: dynamic(() => import("./widgets/bar-compare").then((m) => m.BarCompare), {
    ssr: false,
    loading: skeleton(200),
  }),
  Donut: dynamic(() => import("./widgets/donut").then((m) => m.Donut), {
    ssr: false,
    loading: skeleton(260),
  }),
  Stepper: dynamic(() => import("./widgets/stepper").then((m) => m.Stepper), {
    ssr: false,
    loading: skeleton(220),
  }),
};

export function BlogWidget({ component, props }: { component: string; props: unknown }) {
  const Widget = REGISTRY[component];
  if (!Widget) {
    // Surface the authoring mistake instead of rendering nothing — a missing
    // registration is a bug the author needs to see, not a silent gap.
    return (
      <div className="border border-dashed border-border bg-card p-4 font-mono text-xs text-muted-foreground">
        Unknown blog widget:{" "}
        <span className="text-foreground">&quot;{component}&quot;</span> — register it in
        components/blog/blog-widget.tsx
      </div>
    );
  }
  return <Widget {...(props as Record<string, unknown>)} />;
}
