// Recovery for the installed-PWA "failed to load chunk" error.
//
// After a deploy, a still-open tab (or an SW-cached app shell) can hold HTML
// that references `/_next/static/chunks/<hash>.js` files the new build removed
// from the origin. A lazy import of one of those chunks then 404s and throws a
// ChunkLoadError, dead-ending the user on the error screen. The durable fix is
// to detect that specific failure, drop the service-worker caches, and reload
// onto the current build.

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

// Clear the SW caches and hard-reload. Guarded to at most once per 10s (via
// sessionStorage) so a genuinely broken build — where the chunk is missing
// even on the current deploy — surfaces the error UI instead of looping.
// Returns whether a reload was triggered.
export async function recoverFromChunkError(): Promise<boolean> {
  if (typeof window === "undefined") return false;
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
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Cache eviction is best-effort; reload regardless.
  }
  window.location.reload();
  return true;
}
