"use client";

import { useEffect, useState } from "react";

// Registers the service worker (public/sw.js). Production only — a SW in dev
// serves stale bundles and makes HMR misbehave.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failing (e.g. private browsing) just means no offline
      // support — the app itself is unaffected.
    });
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
