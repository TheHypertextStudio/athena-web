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
 * **What this worker deliberately does not do.** It never caches an API or auth response; see
 * `routing.ts`, where those two rules are the security floor and admit no exception. It precaches no
 * build manifest, because Next's content-hashed asset URLs make a runtime cache-first strategy
 * self-healing without one. And it does not replay writes — the offline write queue lives in the
 * page (`src/components/pwa/`), where it can show what is pending and be reasoned about by a person,
 * rather than firing invisibly from a worker nobody is watching.
 *
 * It *does* cache route documents, which is a change from the original design and is argued in
 * `documents.ts`: an app route's HTML is no longer the contentless shell that file's predecessor
 * assumed, so the cache is keyed on the signed-in user and torn down with the rest of local session
 * state.
 *
 * The update handshake is why `install` does not call `skipWaiting()`. A new worker installs and
 * waits; the page notices and offers a reload; only on acceptance does the page post
 * `SKIP_WAITING`, the worker activate, and the page reload. Swapping the worker out from under a
 * live tab would otherwise mix old chunks with new ones mid-session.
 */
import { IDENTITY_CACHE, purgePrivateDocuments, writeOfflineIdentity } from './documents';
import { answerEndpoint, readPushPayload, resolveNotificationIntent } from './elicitation-push';
import { routeRequest } from './routing';
import { cacheFirst, navigateWithDocumentCache, staleWhileRevalidate } from './strategies';

declare const self: ServiceWorkerGlobalScope;

/** Replaced at build time. Next's `BUILD_ID` in a real build, `'dev'` otherwise. */
declare const __SW_BUILD_ID__: string;
/** Replaced at build time: `'production'` or `'development'`. */
declare const __SW_MODE__: string;
/** Replaced at build time with `NEXT_PUBLIC_API_URL` — a worker cannot read the app's env. */
declare const __SW_API_ORIGIN__: string;
/** Replaced at build time with every `/_next/static` URL. Empty in development. */
declare const __SW_PRECACHE__: readonly string[];

const VERSION = __SW_BUILD_ID__;
const PRODUCTION = __SW_MODE__ === 'production';

const PRECACHE = `docket-precache-${VERSION}`;
const STATIC_CACHE = `docket-static-${VERSION}`;
const ASSET_CACHE = `docket-assets-${VERSION}`;
/**
 * Route documents served offline. Versioned like the others, so a deploy drops every stored shell
 * rather than pairing yesterday's HTML with today's chunks.
 */
const DOCUMENT_CACHE = `docket-documents-${VERSION}`;
// IDENTITY_CACHE is deliberately unversioned and therefore listed here: who is signed in does not
// change across deploys, and evicting it every release would make the first offline launch after
// each one find nothing.
const OWNED_CACHES = new Set([PRECACHE, STATIC_CACHE, ASSET_CACHE, DOCUMENT_CACHE, IDENTITY_CACHE]);

const OFFLINE_URL = '/offline.html';

/** The offline document and the icons it needs. All user-agnostic, all committed. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

/**
 * How long a navigation waits before a cached copy of the same route is preferred to a response
 * still in flight.
 */
const NAVIGATION_TIMEOUT_MS = 3_000;

/**
 * The hard ceiling on a navigation that has neither answered nor failed.
 *
 * @remarks
 * Long enough that a cold start, a first compile, or a bad phone connection still wins — showing
 * "you're offline" to someone who is merely on a slow network is a lie, and it was observed for
 * real at the old three-second cut-off. Short enough that a connection which accepted the request
 * and then stalled (a captive portal) resolves to the waiting-room page instead of an empty tab.
 */
const NAVIGATION_GIVE_UP_MS = 20_000;

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
      // Deliberately not awaited, and deliberately not in `install`. Blocking installation on a few
      // megabytes would make every release wait on the slowest connection before the update prompt
      // could even appear; this fills in behind a working app instead.
      void warmBuildAssets();
    })(),
  );
});

/**
 * Fetch every build asset into the static cache, so a route nobody has visited can still render.
 *
 * @remarks
 * This is what makes offline coverage a property of the *release* rather than of where a person
 * happened to browse. Without it, cache-first only ever holds the chunks already fetched, so the
 * route you need on the train is the one you never opened.
 *
 * Three things keep it polite. It runs after activation rather than during install, so it never
 * delays an update. It skips outright when the browser reports Data Saver, because a few megabytes
 * of speculative download is exactly what that setting exists to refuse. And it goes a few at a
 * time, so it neither saturates the connection nor queues 200 requests ahead of anything the person
 * actually asked for.
 *
 * Individual failures are ignored: a missed asset is fetched on demand later by the normal
 * cache-first rule, which is the behaviour that existed before any of this.
 */
async function warmBuildAssets(): Promise<void> {
  if (__SW_PRECACHE__.length === 0) return;
  // `connection` is not in the standard ServiceWorker lib; the cast is the narrowest acknowledgement.
  const saveData = (self.navigator as unknown as { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  if (saveData === true) return;

  try {
    const cache = await caches.open(STATIC_CACHE);
    const missing: string[] = [];
    for (const url of __SW_PRECACHE__) {
      if (!(await cache.match(url))) missing.push(url);
    }

    const BATCH = 6;
    for (let index = 0; index < missing.length; index += BATCH) {
      await Promise.all(
        missing.slice(index, index + BATCH).map((url) =>
          cache.add(url).catch(() => {
            /* Fetched on demand later by the cache-first rule. */
          }),
        ),
      );
    }
  } catch {
    /* Storage denied or quota exhausted. Offline coverage narrows; nothing else changes. */
  }
}

self.addEventListener('message', (event) => {
  // The field is `type`, never `message`: the repository's error-source policy scans web source for
  // any property named `message`, and the page-side registrar lives under `src/`.
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return;
  const type = (data as { type?: unknown }).type;

  if (type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }

  // Who the document cache belongs to. Posted by the page after the session resolves — the worker
  // has no way to ask, and on a cold offline start it needs the answer before any page exists.
  //
  if (type === 'OFFLINE_IDENTITY') {
    const userId = (data as { userId?: unknown }).userId;
    event.waitUntil(writeOfflineIdentity(typeof userId === 'string' && userId ? userId : null));
    return;
  }

  // Sign-out. Paired with the IndexedDB purge in `src/lib/sign-out.ts` so local session state is
  // cleared from every place it can live, in one action.
  if (type === 'PURGE_PRIVATE') {
    event.waitUntil(purgePrivateDocuments());
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
        navigateWithDocumentCache(request, {
          documentCache: DOCUMENT_CACHE,
          offlineCache: PRECACHE,
          offlineUrl: OFFLINE_URL,
          timeoutMs: NAVIGATION_TIMEOUT_MS,
          giveUpMs: NAVIGATION_GIVE_UP_MS,
          origin: self.location.origin,
          online: self.navigator.onLine,
        }),
      );
      return;
  }
});

/**
 * Show one of Athena's questions as an actionable notification.
 *
 * @remarks
 * `actions` is what makes this more than a nudge: a confirmation or a short selection arrives with
 * its own answers as buttons, so the question can be settled from the banner. `renotify` is off and
 * `tag` is the question id, so re-announcing a question replaces its banner instead of stacking.
 */
self.addEventListener('push', (event) => {
  const payload = readPushPayload(event.data?.text() ?? null);
  if (!payload) return;
  // `actions` is only declared on the ServiceWorker flavour of `NotificationOptions`, which this
  // project's TS lib does not carry; the cast is the narrowest place to acknowledge that.
  const options = {
    body: payload.body,
    tag: payload.tag,
    data: payload.data,
    icon: '/icons/icon-192.png',
    badge: '/icon.svg',
    requireInteraction: payload.requireInteraction,
    actions: payload.actions.map((action) => ({ ...action })),
  } as NotificationOptions;
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

/**
 * Answer from the banner, or land on the question in the context of its task.
 *
 * @remarks
 * The answer POST is cross-origin to the API but same-site, so the session cookie rides along with
 * `credentials: 'include'`. If it does not (a revoked session, an offline device), the worker falls
 * back to opening the question — the person still gets there, and nothing silently reports an
 * answer that was never recorded.
 */
self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  notification.close();
  const intent = resolveNotificationIntent(
    event.action,
    (notification.data ?? {}) as Record<string, unknown>,
  );
  if (intent.kind === 'ignore') return;

  event.waitUntil(
    (async () => {
      if (intent.kind === 'answer') {
        try {
          const response = await fetch(answerEndpoint(__SW_API_ORIGIN__, intent.elicitationId), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: intent.value }),
          });
          if (response.ok) return;
        } catch {
          // Fall through to opening the question.
        }
      }
      const url = intent.url;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.includes(url)) {
          await client.focus();
          return;
        }
      }
      const existing = windows[0];
      if (existing) {
        await existing.navigate(url);
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

export {};
