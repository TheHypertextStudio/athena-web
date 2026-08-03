/**
 * The offline document cache — what makes a previously-visited route come back offline instead of
 * a waiting-room page.
 *
 * @remarks
 * **This module deliberately relaxes a security floor the rest of the worker still holds, and the
 * reasoning is the whole point of the file.**
 *
 * `routing.ts` states that no authenticated response ever enters Cache Storage. That was true and
 * cheap while it was also true that an app route's HTML carried nothing worth keeping. It is no
 * longer true: `src/app/(app)/layout.tsx` runs a server-side session check, prefetches the caller's
 * organizations, and dehydrates them into the document. An authenticated `/today` therefore ships
 * that person's workspace list — and their session-derived identity — inside the HTML.
 *
 * Serving a previously-visited route offline requires keeping that document. So the invariant here
 * is not "never store it" but the same one the persisted query cache already lives under, and it is
 * enforced by three independent mechanisms rather than by a promise:
 *
 * 1. **Nothing is stored until the page names its user.** The cache key embeds the signed-in user
 *    id, which arrives by `postMessage` after the session resolves. Before that — a signed-out
 *    visitor, a cold worker, the sign-in page itself — {@link readOfflineIdentity} answers `null`
 *    and every document is passed straight through, cached by nobody.
 * 2. **A different user wipes it.** {@link writeOfflineIdentity} drops the entire document cache the
 *    moment the id it is handed differs from the one it holds, so the second person to sign in on a
 *    shared browser cannot be served the first person's shell even while offline.
 * 3. **Sign-out wipes it.** {@link purgePrivateDocuments} is called from the app's one
 *    `purgeLocalSessionState` path, alongside the IndexedDB query buckets, so "sign out" still means
 *    one thing and clears one set of places.
 *
 * What this does not defend against is an unlocked device with a live session — the same threat
 * model as leaving the tab open, and the same one `query-persist.ts` documents.
 *
 * Redirects are never stored. A signed-out request for `/today` is answered with a redirect to
 * `/sign-in`, which a service worker sees as an `opaqueredirect` (`ok === false`), so
 * {@link isCacheableDocument} rejects it without needing a special case: caching it would pin a
 * sign-in page over a route the person is perfectly entitled to.
 */

/**
 * Cache holding the identity the document cache is keyed on.
 *
 * @remarks
 * Unversioned on purpose. Cache names elsewhere carry the build id so a deploy evicts them, but who
 * is signed in does not change across deploys, and losing that on every release would mean the
 * first offline launch after each deploy silently found nothing.
 */
export const IDENTITY_CACHE = 'docket-identity';

/** The synthetic URL the identity is stored under. Never fetched; only used as a cache key. */
export const IDENTITY_URL = '/__docket-offline-identity';

/**
 * Build the cache key for one route document.
 *
 * @remarks
 * The user id rides in the query string rather than in the cache name so a single cache can be
 * opened, matched and cleared without enumerating names — and so a key written for one person can
 * never be matched by a lookup performed for another. `__docket_u` is namespaced to make an
 * accidental collision with a real query parameter impossible.
 *
 * The path is used bare, without its query string: `/today` and `/today?tab=all` render the same
 * shell, and keeping them apart would mean a person who always arrives with a query parameter never
 * warms the entry their reload asks for.
 *
 * @param origin - The worker's own origin.
 * @param path - The pathname of the navigation.
 * @param userId - The signed-in user's id.
 * @returns The URL to store and match the document under.
 */
export function documentCacheKey(origin: string, path: string, userId: string): string {
  return `${origin}${path}?__docket_u=${encodeURIComponent(userId)}`;
}

/** The minimal response shape {@link isCacheableDocument} needs, so tests need no real `Response`. */
export interface DocumentResponseShape {
  /** Whether the response succeeded. An `opaqueredirect` reports `false`. */
  readonly ok: boolean;
  /** HTTP status. */
  readonly status: number;
  /** Response headers. */
  readonly headers: { get(name: string): string | null };
}

/**
 * Whether a navigation response may be stored for offline replay.
 *
 * @remarks
 * Three conditions, each rejecting a document that would be actively wrong to serve later:
 * a non-OK response (including the `opaqueredirect` a signed-out request produces, whose `status` is
 * `0`), a `206 Partial Content`, and anything that is not HTML. The last one matters because a
 * navigation can legitimately resolve to a download.
 *
 * @param response - The response returned by the network.
 * @returns Whether to store it.
 */
export function isCacheableDocument(response: DocumentResponseShape): boolean {
  if (!response.ok || response.status !== 200) return false;
  const type = response.headers.get('content-type') ?? '';
  return type.includes('text/html');
}

/**
 * Read the user id the document cache is currently keyed on.
 *
 * @returns The id, or `null` when no page has named one since the last purge.
 */
export async function readOfflineIdentity(): Promise<string | null> {
  try {
    const cache = await caches.open(IDENTITY_CACHE);
    const hit = await cache.match(IDENTITY_URL);
    if (!hit) return null;
    const id = (await hit.text()).trim();
    return id.length > 0 ? id : null;
  } catch {
    // Storage denied (private mode, quota, a browser that revoked it mid-session). Offline
    // documents are an enhancement; losing them costs offline replay and nothing else.
    return null;
  }
}

/**
 * Record who the document cache belongs to, dropping it if that is someone else.
 *
 * @remarks
 * Called on every session resolution, not only on a change, because the worker may have been
 * evicted and restarted between two loads. Writing the same id twice is a no-op; writing a
 * different one — or `null`, which is what a sign-out looks like — clears every stored document
 * first.
 *
 * @param userId - The signed-in user, or `null` when there is none.
 */
export async function writeOfflineIdentity(userId: string | null): Promise<void> {
  try {
    const current = await readOfflineIdentity();
    if (current === userId) return;
    if (current !== null) await purgeDocumentCaches();
    const cache = await caches.open(IDENTITY_CACHE);
    if (userId === null) {
      await cache.delete(IDENTITY_URL);
      return;
    }
    await cache.put(
      IDENTITY_URL,
      new Response(userId, { headers: { 'Content-Type': 'text/plain' } }),
    );
  } catch {
    /* See readOfflineIdentity: storage failures cost offline replay only. */
  }
}

/** Delete every stored route document, for every build id. */
export async function purgeDocumentCaches(): Promise<void> {
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('docket-documents-'))
        .map((name) => caches.delete(name)),
    );
  } catch {
    /* Nothing reachable to purge. */
  }
}

/**
 * Forget both the stored documents and who they belonged to.
 *
 * @remarks
 * The pair is what sign-out means here: leaving the identity behind would let the next document
 * written under it be matched by the next person to reach this browser.
 */
export async function purgePrivateDocuments(): Promise<void> {
  await purgeDocumentCaches();
  try {
    await caches.delete(IDENTITY_CACHE);
  } catch {
    /* Nothing reachable to purge. */
  }
}
