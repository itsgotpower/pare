"use client";

// Recovery for the installed-PWA "failed to load chunk" error.
//
// After a deploy, a still-open tab (or an SW-cached app shell) can hold HTML
// that references `/_next/static/chunks/<hash>.js` files the new build removed
// from the origin. A lazy import of one of those chunks then 404s and throws a
// ChunkLoadError, dead-ending the user on the error screen. The durable fix is
// to detect that specific failure, drop the service-worker caches, and reload
// onto the current build.

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/report-error";

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  const name = typeof e.name === "string" ? e.name : "";
  const msg =
    typeof e.message === "string"
      ? e.message
      : typeof err === "string"
        ? err
        : String(err);
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [^\s]+ failed/i.test(msg) ||
    /Failed to load chunk/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

// The share-target intake cache (public/sw.js SHARE_CACHE) holds files the
// user shared into the app that /upload has not consumed yet — wiping it
// silently loses their statements. sw.js's activate keep-list preserves it for
// the same reason.
const SHARE_CACHE = "pare-share-intake";

// Clear the SW caches and hard-reload. Guarded to at most once per 10s (via
// sessionStorage) so a genuinely broken build — where the chunk is missing
// even on the current deploy — surfaces the error UI instead of looping.
// Returns whether a reload was triggered.
export async function recoverFromChunkError(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Offline, a failed dynamic import throws the same browser messages as a
  // deploy mismatch (isChunkLoadError can't tell them apart). Wiping the
  // caches then would destroy the SW's offline read-through and the /offline
  // fallback — turning an offline blip into an empty app. Not recoverable by
  // reloading either; let the error UI show.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const KEY = "pare-chunk-recovery-at";
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage can throw (private mode) — proceed without the guard.
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("pare-") && k !== SHARE_CACHE)
          .map((k) => caches.delete(k))
      );
    }
  } catch {
    // Cache eviction is best-effort; reload regardless.
  }
  window.location.reload();
  return true;
}

// Shared error-boundary behavior for app/error.tsx and app/global-error.tsx.
// Returns whether the boundary should render the "UPDATING… / Reloading…"
// state (a recovery reload is in flight) instead of the real error UI.
//
// Production only — in dev, HMR churn throws chunk errors and a cache-wiping
// auto-reload would mask the real failure (same gate as ChunkGuard). When
// recoverFromChunkError declines (loop guard tripped: the chunk is missing on
// the CURRENT build; or offline), this is not deploy churn — fall through to
// the real error UI and report to the beacon so monitoring sees broken builds.
export function useChunkRecovery(error: Error & { digest?: string }): boolean {
  const autoRecover =
    isChunkLoadError(error) && process.env.NODE_ENV === "production";
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (!autoRecover) {
      // Report to the monitoring beacon (redacted server-side, forwarded to Sentry).
      reportClientError(error);
      return;
    }
    let cancelled = false;
    void recoverFromChunkError().then((reloading) => {
      if (reloading || cancelled) return;
      setDeclined(true);
      reportClientError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [error, autoRecover]);

  return autoRecover && !declined;
}
