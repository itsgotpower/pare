"use client";

// Drop the service worker's per-user DATA cache (public/sw.js DATA_CACHE =
// `pare-data-v2-<buildId>`), which holds cached GET /api/* responses — balances,
// net worth, transactions, categories. That cache is keyed only on the build id,
// NOT on the authenticated user, so on a shared browser (hosted multi-tenant)
// one tenant's financial PII would otherwise persist after logout and could be
// served to the next signed-in user offline. Call this whenever the session
// ends (logout) or before a new one begins (the /login mount) so no tenant's
// data outlives their session in Cache Storage.
//
// We delete ONLY the data caches: the static shell (`pare-static-*`) is not
// user-specific, and the share-intake cache (`pare-share-intake`) holds files
// the user shared but hasn't uploaded yet — wiping it would silently lose them
// (same reasoning as the sw.js activate keep-list and chunk-recovery).
export async function purgeDataCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("pare-data-")).map((k) => caches.delete(k))
    );
  } catch {
    // Best-effort — never block logout/login on cache eviction.
  }
}
