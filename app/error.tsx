"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-error";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    // A stale app shell asked for a chunk the current deploy removed. Don't
    // dead-end the user (or spam the beacon with deploy churn) — clear the SW
    // cache and reload onto the new build (loop-guarded in recoverFromChunkError).
    if (chunk) {
      void recoverFromChunkError();
      return;
    }
    // Report to the monitoring beacon (redacted server-side, forwarded to Sentry).
    reportClientError(error);
  }, [error, chunk]);

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh]">
      <h2 className="font-mono text-xl font-bold tracking-tight uppercase mb-4">
        {chunk ? "UPDATING…" : "SOMETHING WENT WRONG"}
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
        {chunk
          ? "A new version of Pare shipped. Reloading…"
          : error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={chunk ? () => window.location.reload() : reset}
        className="px-4 py-2 border border-foreground font-mono text-xs tracking-widest uppercase hover:bg-foreground hover:text-background transition-colors"
      >
        {chunk ? "RELOAD" : "TRY AGAIN"}
      </button>
    </div>
  );
}
