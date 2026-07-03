// pare service worker — installability + offline read-through.
//
// Strategies:
//   - /_next/static + fonts/images: cache-first (content-hashed, immutable)
//   - same-origin GET /api/*:       network-first, fall back to last cached
//                                   response (offline read-through of data)
//   - navigations:                  network-first, fall back to cached page,
//                                   then the precached /offline card
//   - POST /upload:                 Web Share Target intake (Android) — stash
//                                   shared files in Cache Storage, redirect to
//                                   /upload?share-target=1 for the page to pick
//                                   up and run through the normal upload flow
//
// Cache version = a base epoch (bump when the caching LOGIC changes) plus the
// per-deploy build id. RegisterSW registers this script as `/sw.js?v=<buildId>`
// (NEXT_PUBLIC_BUILD_ID), so the SW's own URL carries the build: a new deploy
// gives every cache a new name, and `activate` drops the previous deploy's
// caches. That's what fixes the installed-PWA chunk-load error — a stale app
// shell's `/_next/static` chunks (whose hashes the new build removed from the
// origin) are evicted on update instead of lingering and 404-ing.
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `v2-${BUILD}`;
const STATIC_CACHE = `pare-static-${VERSION}`;
const DATA_CACHE = `pare-data-${VERSION}`;
const SHARE_CACHE = "pare-share-intake";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll([OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"])
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = [STATIC_CACHE, DATA_CACHE, SHARE_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Never serve cached auth/session state — it must always reflect the server.
function isCacheableApi(url) {
  return url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth");
}

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|svg|ico|woff2?)$/.test(url.pathname)
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, offlineFallback) {
  try {
    const response = await fetch(request);
    // Skip redirected responses: a signed-out gated navigation 307s to
    // /login — caching that under the original URL would show the login page
    // for every offline visit to that route.
    if (response.ok && !response.redirected && request.method === "GET") {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (offlineFallback) {
      const fallback = await caches.match(OFFLINE_URL);
      if (fallback) return fallback;
    }
    return Response.json({ error: "offline" }, { status: 503 });
  }
}

// Web Share Target: store each shared file as a cached Response the /upload
// page can read back, then bounce to the page (303 so the POST isn't retried).
async function handleShareTarget(request) {
  const formData = await request.formData();
  const files = formData.getAll("statements").filter((f) => f instanceof File);
  const cache = await caches.open(SHARE_CACHE);
  await Promise.all(
    files.map((file, i) =>
      cache.put(
        new Request(`/share-intake/${i}`),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name || `statement-${i}.pdf`),
          },
        })
      )
    )
  );
  return Response.redirect("/upload?share-target=1", 303);
}

// Web Push: payload is JSON { title, body, url } (see lib/push/webpush.ts).
self.addEventListener("push", (event) => {
  let data = { title: "pare", body: "", url: "/dashboard" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — show the default.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        existing.navigate(url);
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === "POST" && url.pathname === "/upload") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== "GET") return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(event.request));
  } else if (isCacheableApi(url)) {
    event.respondWith(networkFirst(event.request, DATA_CACHE, false));
  } else if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, DATA_CACHE, true));
  }
});
