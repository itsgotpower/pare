"use client";

import { useEffect, useState } from "react";
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
    const build = process.env.NEXT_PUBLIC_BUILD_ID || process.env.NEXT_PUBLIC_APP_VERSION || "";
    const url = build ? `/sw.js?v=${encodeURIComponent(build)}` : "/sw.js";
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
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) void recoverFromChunkError();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

// Fixed bottom notice while offline: the SW is serving last-synced data, so
// say so instead of letting stale numbers pass as live.
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-foreground text-background text-center font-mono text-[11px] tracking-widest uppercase py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
      OFFLINE — SHOWING LAST-SYNCED DATA
    </div>
  );
}
