"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";

// Registers the service worker (public/sw.js). Production only — a SW in dev
// serves stale bundles and makes HMR misbehave.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // Tie the SW url to the build id so a new deploy is a byte-different script
    // url — the browser then updates the SW, which (via versioned cache names)
    // evicts the previous build's cached chunks. Without this the SW file is
    // identical across deploys, never updates, and keeps serving a stale shell.
    // NEXT_PUBLIC_BUILD_ID is always defined (next.config.ts `env`); an
    // unversioned /sw.js would pin cache names to "v2-dev" across every future
    // deploy (public/sw.js falls back to BUILD="dev"), silently disabling the
    // per-deploy eviction — so there is deliberately no fallback URL here.
    const build = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
    const url = `/sw.js?v=${encodeURIComponent(build)}`;
    navigator.serviceWorker.register(url).catch(() => {
      // Registration failing (e.g. private browsing) just means no offline
      // support — the app itself is unaffected.
    });
  }, []);
  return null;
}

// Catches ChunkLoadErrors that escape React's error boundaries (rejected lazy
// imports, webpack's global chunk-load failures) and recovers by clearing the
// SW cache + reloading onto the current build. React-render chunk failures are
// handled in app/error.tsx; this is the belt-and-suspenders for the rest.
// Production only — in dev, HMR churns chunks and we don't want auto-reloads.
export function ChunkGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error) || isChunkLoadError(e.message)) {
        void recoverFromChunkError();
        return;
      }
      // Resource load failures (a chunk <script>/<link> tag that 404'd) fire on
      // the element with no message — a failed /_next/static asset after a
      // deploy is the same stale-shell mismatch as a thrown ChunkLoadError.
      const target = e.target;
      const src =
        target instanceof HTMLScriptElement
          ? target.src
          : target instanceof HTMLLinkElement
            ? target.href
            : "";
      if (src.includes("/_next/static/")) void recoverFromChunkError();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) void recoverFromChunkError();
    };
    // capture: true — resource load errors (<script>/<link> chunk 404s) fire
    // on the element and don't bubble; only a capture-phase listener sees them.
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

function subscribeToConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Fixed bottom notice while offline: the SW is serving last-synced data, so
// say so instead of letting stale numbers pass as live.
export function OfflineBanner() {
  const offline = useSyncExternalStore(
    subscribeToConnectivity,
    () => !navigator.onLine,
    () => false // SSR: assume online, corrected on hydration
  );

  if (!offline) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-foreground text-background text-center font-mono text-[11px] tracking-widest uppercase py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      OFFLINE — SHOWING LAST-SYNCED DATA
    </div>
  );
}
