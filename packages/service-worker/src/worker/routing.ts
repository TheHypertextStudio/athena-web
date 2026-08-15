/**
 * The service worker's routing table, as a pure function.
 *
 * @remarks
 * Split from `sw.ts` so it can be unit-tested in the app's normal Vitest run: the worker itself
 * needs a `ServiceWorkerGlobalScope`, but *which strategy applies to a URL* is plain logic, and it
 * is the part where a mistake is expensive — caching an authenticated API response, or swallowing
 * a dev-server request and breaking hot reload.
 *
 * Next emits content-hashed, immutable filenames under `/_next/static`, so cache-first is
 * self-healing: a new build requests new URLs and simply misses. That is why nothing here needs
 * Workbox or Serwist, both of which are webpack plugins that would force this Turbopack app onto
 * the webpack builder.
 *
 * **It is not, however, why this worker once had no precache manifest.** That argument was made
 * here and it was wrong: self-healing is a property of *correctness*, not of *coverage*. A chunk
 * that has never been fetched is not in the cache, so cache-first has nothing to be first about —
 * which is exactly why a route nobody visited could not render offline. `scripts/precache-manifest.ts`
 * now lists every emitted asset, under a build-enforced byte budget, and `sw.ts` warms them after
 * activation. See `docs/engineering/specs/offline.md`.
 */

/** What the fetch handler should do with a request. */
export type CacheStrategy =
  /** Do not call `respondWith` at all — let the request go to the network untouched. */
  | 'passthrough'
  /** Serve from cache when present, otherwise fetch and store. For immutable URLs only. */
  | 'cache-first'
  /** Serve from cache immediately and refresh the entry in the background. */
  | 'stale-while-revalidate'
  /** Try the network, fall back to the offline document. Responses are never cached. */
  | 'navigation';

/**
 * Path prefixes this origin answers on but does not own — each rewritten by `next.config.ts` to a
 * different application, so origin alone cannot exclude them.
 *
 * @remarks
 * Two reasons, both load-bearing. `/api/auth` and `/v1` carry authenticated data that must never
 * enter Cache Storage. `/docs` is Mintlify: a navigation there would be stored under the *shell*
 * key, and the shell is only interchangeable across routes because `(app)/layout.tsx` renders the
 * same chrome for all of them — so the next offline navigation would boot a docs page with no
 * `RouteSlot` and no way back.
 *
 * The two `mintlify` asset prefixes already reach the terminal `passthrough`, being non-navigation
 * GETs; listing them keeps that a decision rather than an accident.
 */
const PROXIED_PREFIXES = ['/api/auth', '/v1', '/docs', '/_mintlify', '/mintlify-assets'] as const;

/** The inputs the routing decision depends on. */
export interface RouteRequest {
  /** HTTP method. */
  readonly method: string;
  /** Fully-qualified request URL. */
  readonly url: string;
  /** The worker's own origin; anything else is another party's business. */
  readonly origin: string;
  /** Whether this is a top-level document navigation. */
  readonly isNavigation: boolean;
  /** Whether the worker was built for production. Dev assets are not immutable. */
  readonly production: boolean;
}

/**
 * Decide how to handle a request.
 *
 * @remarks
 * Evaluated in order; the first match wins. {@link PROXIED_PREFIXES} is the security floor and must
 * stay ahead of every caching rule: **no authenticated response ever enters Cache Storage.**
 * Because of it the worker needs no per-user cache partitioning, and signing out on a shared device
 * has nothing to purge here — the only place user data persists is the per-user IndexedDB query
 * cache, which is cleared explicitly. Weakening that list turns this worker into a data leak.
 *
 * @param request - The request being routed.
 * @returns The strategy to apply.
 */
export function routeRequest(request: RouteRequest): CacheStrategy {
  const { method, url, origin, isNavigation, production } = request;

  // Only GETs are ever cacheable, and another origin's caching policy is not ours to override.
  if (method !== 'GET') return 'passthrough';
  if (!url.startsWith(`${origin}/`)) return 'passthrough';

  const path = pathOf(url, origin);

  // --- Security floor. Never cache, never intercept. ---
  if (PROXIED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return 'passthrough';
  }

  // --- Dev-server plumbing. Intercepting any of this breaks hot reload. ---
  if (isDevPath(path) || url.includes('?_rsc=') || url.includes('__nextDataReq')) {
    return 'passthrough';
  }

  // Next's image optimizer negotiates on Accept headers, so a URL-keyed cache would serve the
  // wrong format to the wrong browser.
  if (path.startsWith('/_next/image')) return 'passthrough';

  // Content-hashed and immutable in a production build. Under Turbopack in dev the same paths are
  // rebuilt in place, so caching them would serve stale chunks.
  if (path.startsWith('/_next/static/')) return production ? 'cache-first' : 'passthrough';

  // Small, stable, and worth having offline; revalidated in the background so a redeploy is picked
  // up without a hard refresh.
  if (
    path.startsWith('/icons/') ||
    path === '/manifest.webmanifest' ||
    path === '/icon.svg' ||
    path.startsWith('/apple-icon')
  ) {
    return 'stale-while-revalidate';
  }

  // Documents get the offline fallback but are themselves never stored: an authenticated route's
  // HTML would otherwise be replayable to whoever opens the browser next.
  if (isNavigation) return 'navigation';

  return 'passthrough';
}

/** The pathname of a same-origin URL, without allocating a `URL` for the common case. */
function pathOf(url: string, origin: string): string {
  const rest = url.slice(origin.length);
  const queryAt = rest.indexOf('?');
  const hashAt = rest.indexOf('#');
  const end = Math.min(
    queryAt === -1 ? rest.length : queryAt,
    hashAt === -1 ? rest.length : hashAt,
  );
  return rest.slice(0, end);
}

/** Whether a path belongs to the dev server rather than the application. */
function isDevPath(path: string): boolean {
  return (
    path.startsWith('/_next/webpack-hmr') ||
    path.startsWith('/__nextjs') ||
    path.startsWith('/_next/static/development/') ||
    path.startsWith('/_next/turbopack')
  );
}
