/**
 * Cache strategies — the runtime half of the worker's routing table.
 *
 * @remarks
 * An ES module in its own right, importable and individually reviewable. `sw.ts` wires events to
 * these; `routing.ts` decides which one applies. Splitting the three keeps the piece that decides
 * *policy* (pure, unit-tested) apart from the piece that performs *IO*.
 *
 * Nothing here caches a response the routing table did not already clear for caching — the API and
 * auth exclusions live in `routing.ts`, and these functions trust them. The one place a *document*
 * is stored is {@link navigateWithDocumentCache}, whose own gate (a named user, a non-redirected
 * 200 HTML response) is documented in `documents.ts`.
 */
import { documentCacheKey, isCacheableDocument, readOfflineIdentity } from './documents';

/**
 * Serve from cache, falling back to the network and storing the result.
 *
 * @remarks
 * Correct **only** for immutable URLs. Next's `/_next/static` filenames are content-hashed, so a
 * new build requests new URLs and simply misses — which is what makes this self-healing without a
 * precache manifest, and why this worker needs no Workbox or Serwist build step.
 *
 * @param request - The request to satisfy.
 * @param cacheName - Cache to read and populate.
 * @returns The cached response when present, otherwise the network response.
 */
export async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

/**
 * Serve the cached copy immediately and refresh it in the background.
 *
 * @param request - The request to satisfy.
 * @param cacheName - Cache to read and populate.
 * @returns The cached response when present, otherwise the network response.
 */
export async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (hit) {
    // Deliberately not awaited: the point is to answer from cache now and let the refresh land
    // whenever it lands.
    void network;
    return hit;
  }
  return (await network) ?? Response.error();
}

/** Everything {@link navigateWithDocumentCache} needs to answer one navigation. */
export interface NavigationOptions {
  /** Cache holding previously-served route documents, keyed by user. */
  readonly documentCache: string;
  /** Cache holding the precached offline document. */
  readonly offlineCache: string;
  /** Path of the offline document. */
  readonly offlineUrl: string;
  /**
   * How long a navigation waits before a cached copy of the same route is preferred to a network
   * response that has not arrived.
   */
  readonly timeoutMs: number;
  /**
   * The hard ceiling on waiting for a network that has neither answered nor failed, after which the
   * offline document is served.
   */
  readonly giveUpMs: number;
  /** The worker's own origin. */
  readonly origin: string;
  /** The browser's own connectivity signal, sampled at request time. */
  readonly online: boolean;
}

/**
 * Answer a navigation from the network, from the last document served for that exact route, or —
 * only if neither exists — from the offline page.
 *
 * @remarks
 * The ordering is what makes "the app comes back offline" true rather than "the app shows a waiting
 * room offline". A route visited while online has its document stored; reloading it with no
 * connection re-renders that shell, which then repopulates itself from the persisted TanStack Query
 * cache in IndexedDB. Nothing about that is a fabrication: it is genuinely the last state the server
 * sent, and the app's own offline banner says so on screen.
 *
 * `online === false` short-circuits to the cache **before** touching the network. Waiting out the
 * timeout on a device that already knows it has no radio would put a stall in front of every offline
 * navigation, which is exactly the "is it broken?" feeling offline support exists to remove. The
 * network is still attempted afterwards when the cache misses, because `navigator.onLine === false`
 * is a hint and is occasionally wrong in the useful direction.
 *
 * **`timeoutMs` no longer means "give up".** It used to: a navigation that had not answered in three
 * seconds was replaced by the offline page. That told people they were offline when they were not —
 * observed for real on a route the dev server was compiling for the first time, and equally reachable
 * in production on a cold serverless start or a slow phone network. A page cannot know it is offline
 * from slowness alone. So the timeout now only decides when a *cached copy of the same route* is
 * preferred to a response still in flight, and the offline document appears only when the request
 * genuinely fails or when `giveUpMs` — a much longer, honestly-named ceiling — passes with nothing
 * from either side. The captive-portal case the original timeout was written for is still handled;
 * it is just no longer conflated with "slow".
 *
 * Storing is gated on {@link readOfflineIdentity} returning a user: see `documents.ts` for why an
 * anonymous or not-yet-known session stores nothing at all.
 *
 * The offline fallback keeps the requested URL in the address bar, so it reads as a waiting room
 * rather than a dead end: reloading after reconnecting lands on the real route.
 *
 * @param request - The navigation request.
 * @param options - Caches, timings, and the connectivity hint.
 * @returns The network response, the cached document for this route, or the offline document.
 */
export async function navigateWithDocumentCache(
  request: Request,
  options: NavigationOptions,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const userId = await readOfflineIdentity();
  const key = userId === null ? null : documentCacheKey(options.origin, path, userId);

  if (key !== null && !options.online) {
    const cached = await matchDocument(options.documentCache, key);
    if (cached) return cached;
  }

  // Started once and awaited more than once. Rejections are folded into the value so a slow race
  // below can never leave an unhandled rejection behind.
  const network = fetch(request).then(
    (response) => ({ ok: true, response }) as const,
    () => ({ ok: false }) as const,
  );

  if (key !== null) {
    const first = await Promise.race([network, after(options.timeoutMs)]);
    if (first === TIMED_OUT) {
      const cached = await matchDocument(options.documentCache, key);
      // A shell we already have beats staring at a blank tab. The request is left running; if it
      // lands it repopulates the cache on the next navigation.
      if (cached) return cached;
    }
  }

  const settled = await Promise.race([network, after(options.giveUpMs)]);

  if (settled !== TIMED_OUT && settled.ok) {
    if (key !== null && isCacheableDocument(settled.response)) {
      const copy = settled.response.clone();
      const cache = await caches.open(options.documentCache);
      void cache.put(key, copy);
    }
    return settled.response;
  }

  if (key !== null) {
    const cached = await matchDocument(options.documentCache, key);
    if (cached) return cached;
  }
  const cache = await caches.open(options.offlineCache);
  const offline = await cache.match(options.offlineUrl);
  return (
    offline ??
    new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  );
}

/** The sentinel a waiting race resolves to. Distinguishable from any settled fetch outcome. */
const TIMED_OUT = Symbol('timed-out');

/** Resolve to {@link TIMED_OUT} after a delay, without leaving a timer running. */
function after(ms: number): Promise<typeof TIMED_OUT> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, ms);
    // A worker can be terminated between navigations; unref where the runtime supports it so a
    // pending timer never keeps it alive on its own.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

/** Look one route document up, tolerating a storage backend that refuses to open. */
async function matchDocument(cacheName: string, key: string): Promise<Response | undefined> {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(key);
  } catch {
    return undefined;
  }
}
