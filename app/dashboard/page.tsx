"use client";

import dynamic from "next/dynamic";
import { DashboardSkeleton } from "@/components/ui/skeleton";

// The dashboard renders CLIENT-ONLY (ssr:false): it's auth-gated (no SEO), it
// already shows DashboardSkeleton until /api/summary responds, and skipping SSR
// keeps its whole chunk tree (recharts + base-ui, duplicated per route by the
// bundler) out of the worker bundle — the Free-plan 3 MiB cap rejected the
// upload with them in (wrangler error 10027, PR #71).
const Dashboard = dynamic(() => import("./dashboard-client"), {
  ssr: false,
  loading: () => <DashboardSkeleton />,
});

export default function DashboardPage() {
  return <Dashboard />;
}
