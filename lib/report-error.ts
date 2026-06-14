// Client-side error beacon. Called from the React error boundaries
// (app/error.tsx, app/global-error.tsx) to ship a minimal error payload to the
// /api/monitoring endpoint, which redacts + forwards it to Sentry server-side.
//
// Kept dependency-free and defensive: an error boundary must NEVER throw from its
// own reporting. Uses sendBeacon when available (survives a navigation/unmount),
// falling back to keepalive fetch.

export function reportClientError(error: (Error & { digest?: string }) | undefined): void {
  try {
    const body = JSON.stringify({
      message: error?.message,
      stack: error?.stack,
      digest: error?.digest,
      url: typeof location !== "undefined" ? location.pathname : undefined,
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/monitoring", new Blob([body], { type: "application/json" }));
    } else if (typeof fetch === "function") {
      void fetch("/api/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Reporting must never break the error boundary itself.
  }
}
