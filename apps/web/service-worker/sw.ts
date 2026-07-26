/**
 * Docket's service worker — read-only offline support and an explicit update handshake.
 *
 * @remarks
 * Authored as **ES modules** (this file, {@link file://./routing.ts}, and
 * {@link file://./strategies.ts}) in a TypeScript program of its own, then bundled by
 * `scripts/build-service-worker.ts` into a single classic worker at `public/sw.js`. Authoring in
 * ESM and shipping a bundle is what lets the code be modular and individually testable **without**
 * narrowing browser support: native module workers (`register(..., { type: 'module' })`) are still
 * unsupported in Firefox and in Safari before 16.4, and offline support should not be a
 * Chrome-only feature. The bundler resolves the imports at build time, so the shipped worker is a
 * plain classic script every browser can run.
 *
 * **What this worker deliberately does not do.** It does not queue writes — mutations made offline
 * fail immediately and say so, rather than being replayed later against a server whose state has
 * moved on. It does not cache authenticated responses; see `routing.ts`, where the API rules are
 * the security floor. And it precaches no build manifest, because Next's content-hashed asset URLs
 * make a runtime cache-first strategy self-healing without one.
 *
 * The update handshake is why `install` does not call `skipWaiting()`. A new worker installs and
 * waits; the page notices and offers a reload; only on acceptance does the page post
 * `SKIP_WAITING`, the worker activate, and the page reload. Swapping the worker out from under a
 * live tab would otherwise mix old chunks with new ones mid-session.
 */
import { routeRequest } from './routing';
import { cacheFirst, navigateWithFallback, staleWhileRevalidate } from './strategies';

declare const self: ServiceWorkerGlobalScope;

/** Replaced at build time. Next's `BUILD_ID` in a real build, `'dev'` otherwise. */
declare const __SW_BUILD_ID__: string;
/** Replaced at build time: `'production'` or `'development'`. */
declare const __SW_MODE__: string;

const VERSION = __SW_BUILD_ID__;
const PRODUCTION = __SW_MODE__ === 'production';

const PRECACHE = `docket-precache-${VERSION}`;
const STATIC_CACHE = `docket-static-${VERSION}`;
const ASSET_CACHE = `docket-assets-${VERSION}`;
const OWNED_CACHES = new Set([PRECACHE, STATIC_CACHE, ASSET_CACHE]);

const OFFLINE_URL = '/offline.html';

/** The offline document and the icons it needs. All user-agnostic, all committed. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

/** How long a navigation waits for the network before falling back to the offline document. */
const NAVIGATION_TIMEOUT_MS = 3_000;

self.addEventListener('install', (event) => {
  // No skipWaiting: waiting is precisely what makes the update prompt possible.
  event.waitUntil(
    caches.open(PRECACHE).then(async (cache) => {
      await cache.addAll(PRECACHE_URLS);
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Cache names carry the version, so dropping everything not owned by this version is the
      // whole eviction story — no per-entry expiry bookkeeping.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('docket-') && !OWNED_CACHES.has(name))
          .map((name) => caches.delete(name)),
      );
      // Safe here because activation only follows an accepted update (or every tab closing), so no
      // live tab is swapped mid-session.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // The field is `type`, never `message`: the repository's error-source policy scans web source for
  // any property named `message`, and the page-side registrar lives under `src/`.
  const data: unknown = event.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'SKIP_WAITING'
  ) {
    void self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const strategy = routeRequest({
    method: request.method,
    url: request.url,
    origin: self.location.origin,
    isNavigation: request.mode === 'navigate',
    production: PRODUCTION,
  });

  switch (strategy) {
    case 'passthrough':
      // Returning without calling respondWith leaves the request completely untouched — cheaper
      // than proxying it, and it cannot break streaming or range requests.
      return;
    case 'cache-first':
      event.respondWith(cacheFirst(request, STATIC_CACHE));
      return;
    case 'stale-while-revalidate':
      event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
      return;
    case 'navigation':
      event.respondWith(
        navigateWithFallback(request, PRECACHE, OFFLINE_URL, NAVIGATION_TIMEOUT_MS),
      );
      return;
  }
});

export {};
