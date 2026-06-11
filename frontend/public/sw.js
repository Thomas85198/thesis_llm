/* Minimal service worker — exists mainly to make the app installable on tablets
 * (Add to Home Screen → standalone fullscreen). It is deliberately conservative:
 *  - never touches cross-origin requests (the backend API on :8000 always hits
 *    the network, so data is never served stale),
 *  - never caches non-GET,
 *  - navigations are network-first with an offline fallback to the last good
 *    page, so a flaky tablet Wi-Fi still shows something,
 *  - ONLY same-origin hashed/immutable assets (/_next/static/..., icons, fonts)
 *    are cache-first; every other GET (e.g. /version, RSC payloads) passes
 *    through to the network untouched — v1 cached /version and poisoned the
 *    update banner into showing forever after a deploy.
 * Bump CACHE to invalidate everything on the next activation.
 */
const CACHE = "paper-review-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // backend API etc. → network

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await caches.match(req)) || (await caches.match("/zh-Hant")) || Response.error();
        }
      })()
    );
    return;
  }

  // Cache-first is safe ONLY for immutable assets: content-hashed bundles and
  // static icons/fonts. Anything else (/version, RSC payloads, JSON routes)
  // must hit the network every time — let the browser handle it.
  const immutable =
    url.pathname.startsWith("/_next/static/") ||
    /\.(png|svg|ico|jpg|jpeg|webp|woff2?)$/.test(url.pathname);
  if (!immutable) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok && fresh.type === "basic") {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
