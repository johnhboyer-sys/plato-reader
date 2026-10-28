// Service worker: offline reading, cache-as-you-read.
//
// The corpus is far too large to precache wholesale (~hundreds of MB), so the
// contract is honest and simple: anything you have read is available offline.
//
//  - Navigations (page HTML): network-first so deploys show up immediately,
//    falling back to the cached copy offline, then to the offline page.
//  - Hashed build assets (/_astro/): cache-first — content-addressed names
//    make them immutable, and a deploy's new HTML references new names.
//  - Corpus data (/data/) and other same-scope files: network-first, cache
//    fallback. Fresh HTML must never pair with a prior deploy's cached JSON
//    (schema drift), so data is only served from cache when actually offline
//    — where it pairs with equally-old cached HTML, which is consistent.
//  - Fonts: cache-first (immutable binaries) — the self-hosted /fonts/*.woff2
//    files, so a page drawn once online keeps its type offline. Their
//    stylesheet (fonts.css) is ordinary same-scope network-first.
//
// Versioned cache: bump VERSION to invalidate everything after a breaking
// deploy. In particular, bump it whenever the corpus-data or search-index
// SCHEMA changes: navigations/JS are network-first (a deploy's new HTML/JS
// arrive immediately online), but same-URL /data/ JSON is only refreshed
// online, so without a version bump an offline reader could pair fresh JS
// with a stale cached index. Old caches are dropped on activate.
//
// CACHE_PREFIX namespaces our caches so activate only ever deletes caches
// this app owns — Cache Storage is per-ORIGIN, and on GH Pages this origin
// (username.github.io) is shared with sibling project sites (e.g.
// aristotle-reader), whose caches must not be collateral damage.
const CACHE_PREFIX = 'plato-reader-';
const VERSION = CACHE_PREFIX + 'v2';
const SCOPE_PATH = new URL(self.registration.scope).pathname; // e.g. /plato-reader/
const OFFLINE_URL = SCOPE_PATH + 'offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(event, { offlineFallback = false } = {}) {
  const { request } = event;
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    // The write is handed to waitUntil, not awaited: the reader gets the
    // response at network speed, while the event stays alive until the copy
    // has actually landed in the cache.
    if (fresh.ok) event.waitUntil(cache.put(request, fresh.clone()));
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (offlineFallback) return cache.match(OFFLINE_URL);
    throw err;
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok || fresh.type === 'opaque') event.waitUntil(cache.put(request, fresh.clone()));
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(event, { offlineFallback: true }));
    return;
  }

  if (url.origin === location.origin) {
    if (url.pathname.includes('/_astro/')) {
      event.respondWith(cacheFirst(event));
    } else if (url.pathname.startsWith(SCOPE_PATH + 'fonts/') && url.pathname.endsWith('.woff2')) {
      event.respondWith(cacheFirst(event));
    } else if (url.pathname.startsWith(SCOPE_PATH)) {
      // Corpus data, favicons, manifest — always fresh online (a new deploy's
      // HTML must never read an old deploy's JSON), cached copy offline.
      event.respondWith(networkFirst(event));
    }
    return;
  }
  // Nothing cross-origin is cached: the fonts are self-hosted under /fonts/.
});
