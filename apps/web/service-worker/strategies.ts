/**
 * Cache strategies — the runtime half of the worker's routing table.
 *
 * @remarks
 * An ES module in its own right, importable and individually reviewable. `sw.ts` wires events to
 * these; `routing.ts` decides which one applies. Splitting the three keeps the piece that decides
 * *policy* (pure, unit-tested) apart from the piece that performs *IO*.
 *
 * Nothing here caches a response the routing table did not already clear for caching — the
 * security floor lives in `routing.ts`, and these functions trust it.
 */

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

/**
 * Try the network for a document, falling back to the offline page.
 *
 * @remarks
 * The response is never cached. Caching per-route authenticated HTML would make one person's
 * document replayable to whoever opens the browser next, and it would not help anyway — the app
 * routes render a client-side shell, so their HTML carries no content worth keeping.
 *
 * The fallback keeps the requested URL in the address bar, so it reads as a waiting room rather
 * than a dead end: reloading after reconnecting lands on the real route.
 *
 * @param request - The navigation request.
 * @param offlineCache - Cache holding the precached offline document.
 * @param offlineUrl - Path of the offline document.
 * @param timeoutMs - How long to wait before giving up on the network.
 * @returns The network response, or the offline document.
 */
export async function navigateWithFallback(
  request: Request,
  offlineCache: string,
  offlineUrl: string,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await withTimeout(fetch(request), timeoutMs);
  } catch {
    const cache = await caches.open(offlineCache);
    const offline = await cache.match(offlineUrl);
    return (
      offline ??
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

/**
 * Reject if a promise has not settled in time.
 *
 * @remarks
 * Covers the case a plain `fetch` rejection does not: a connection that accepts the request and
 * then stalls (a captive portal). Without it the tab shows nothing until the browser's own much
 * longer timeout fires.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
