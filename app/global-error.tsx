"use client";

// Root error boundary — catches errors thrown in the root layout itself (where
// app/error.tsx can't reach). It must render its OWN <html>/<body>. Reports the
// error via the client beacon, then offers a retry. Kept minimal + brutalist.

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-error";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    // Post-deploy chunk mismatch — recover onto the current build instead of
    // reporting/dead-ending (loop-guarded). See lib/chunk-recovery.ts.
    if (chunk) {
      void recoverFromChunkError();
      return;
    }
    reportClientError(error);
  }, [error, chunk]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "monospace",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {chunk ? "Updating…" : "Something went wrong"}
        </h2>
        <p style={{ maxWidth: "28rem", opacity: 0.7 }}>
          {chunk
            ? "A new version of Pare shipped. Reloading…"
            : "An unexpected error occurred. The team has been notified."}
        </p>
        <button
          onClick={chunk ? () => window.location.reload() : reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            border: "1px solid currentColor",
            background: "transparent",
            font: "inherit",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            cursor: "pointer",
          }}
        >
          {chunk ? "Reload" : "Try again"}
        </button>
      </body>
    </html>
  );
}
