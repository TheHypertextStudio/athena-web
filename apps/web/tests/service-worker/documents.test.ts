import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IDENTITY_CACHE,
  documentCacheKey,
  isCacheableDocument,
  purgeDocumentCaches,
  purgePrivateDocuments,
  readOfflineIdentity,
  writeOfflineIdentity,
} from '../../service-worker/documents';
import { navigateWithDocumentCache } from '../../service-worker/strategies';

/**
 * The offline document cache — the one place this worker stores an authenticated response, and
 * therefore the one place where a mistake is a cross-account leak rather than a missing feature.
 *
 * @remarks
 * jsdom implements no Cache Storage at all, so these run against a small in-memory implementation
 * of exactly the surface the worker uses (`caches.open/keys/delete`, `cache.match/put/delete`). That
 * is enough to exercise every branch that matters — what gets stored, under whose key, and what a
 * lookup for a different person finds — without a browser.
 */

/** A minimal Cache Storage, faithful to the parts the worker depends on. */
class FakeCache {
  readonly entries = new Map<string, Response>();

  /**
   * Real Cache Storage hands out a fresh `Response` per match; a body can only be read once, so
   * returning the stored object would make a second read of the same entry silently fail.
   */
  match(request: RequestInfo): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(keyOf(request))?.clone());
  }

  put(request: RequestInfo, response: Response): Promise<void> {
    this.entries.set(keyOf(request), response);
    return Promise.resolve();
  }

  delete(request: RequestInfo): Promise<boolean> {
    return Promise.resolve(this.entries.delete(keyOf(request)));
  }

  keys(): Promise<Request[]> {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(absolute(url))));
  }
}

function keyOf(request: RequestInfo): string {
  return typeof request === 'string' ? request : request.url;
}

function absolute(path: string): string {
  return path.startsWith('http') ? path : `${ORIGIN}${path}`;
}

const ORIGIN = 'https://docket.test';
let caches_: Map<string, FakeCache>;

/** Open a cache and see it as the fake, whose `entries` the assertions inspect directly. */
async function openFake(name: string): Promise<FakeCache> {
  return (await caches.open(name)) as unknown as FakeCache;
}

function installFakeCaches(): void {
  caches_ = new Map();
  const storage = {
    open: (name: string): Promise<FakeCache> => {
      let cache = caches_.get(name);
      if (!cache) {
        cache = new FakeCache();
        caches_.set(name, cache);
      }
      return Promise.resolve(cache);
    },
    keys: (): Promise<string[]> => Promise.resolve([...caches_.keys()]),
    delete: (name: string): Promise<boolean> => Promise.resolve(caches_.delete(name)),
  };
  Object.defineProperty(globalThis, 'caches', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installFakeCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('documentCacheKey', () => {
  it('keys a route on the person it was rendered for', () => {
    expect(documentCacheKey(ORIGIN, '/today', 'u1')).toBe(`${ORIGIN}/today?__docket_u=u1`);
    // Two accounts can never match each other's entry, because the keys differ.
    expect(documentCacheKey(ORIGIN, '/today', 'u2')).not.toBe(
      documentCacheKey(ORIGIN, '/today', 'u1'),
    );
  });

  it('escapes an id so it cannot forge another key', () => {
    expect(documentCacheKey(ORIGIN, '/today', 'a&b=c')).toBe(
      `${ORIGIN}/today?__docket_u=a%26b%3Dc`,
    );
  });
});

describe('isCacheableDocument', () => {
  const html = {
    get: (name: string) => (name === 'content-type' ? 'text/html; charset=utf-8' : null),
  };

  it('stores a plain HTML 200', () => {
    expect(isCacheableDocument({ ok: true, status: 200, headers: html })).toBe(true);
  });

  it('never stores a redirect', () => {
    // A signed-out request for /today is answered with a redirect to /sign-in, which a worker sees
    // as an opaqueredirect: ok false, status 0. Caching it would pin a sign-in page over a route.
    expect(isCacheableDocument({ ok: false, status: 0, headers: html })).toBe(false);
  });

  it('never stores a non-HTML navigation', () => {
    const pdf = { get: () => 'application/pdf' };
    expect(isCacheableDocument({ ok: true, status: 200, headers: pdf })).toBe(false);
  });

  it('never stores a partial response', () => {
    expect(isCacheableDocument({ ok: true, status: 206, headers: html })).toBe(false);
  });
});

describe('offline identity', () => {
  it('answers null until a page names someone', async () => {
    expect(await readOfflineIdentity()).toBeNull();
  });

  it('remembers the signed-in account', async () => {
    await writeOfflineIdentity('u1');
    expect(await readOfflineIdentity()).toBe('u1');
  });

  it('drops every stored document when a different account signs in', async () => {
    await writeOfflineIdentity('u1');
    const cache = await caches.open('docket-documents-build-1');
    await cache.put(documentCacheKey(ORIGIN, '/today', 'u1'), new Response('u1 shell'));

    await writeOfflineIdentity('u2');

    expect(caches_.has('docket-documents-build-1')).toBe(false);
    expect(await readOfflineIdentity()).toBe('u2');
  });

  it('forgets everything on sign-out', async () => {
    await writeOfflineIdentity('u1');
    const cache = await caches.open('docket-documents-build-1');
    await cache.put(documentCacheKey(ORIGIN, '/today', 'u1'), new Response('u1 shell'));

    await purgePrivateDocuments();

    expect(caches_.has('docket-documents-build-1')).toBe(false);
    expect(caches_.has(IDENTITY_CACHE)).toBe(false);
    expect(await readOfflineIdentity()).toBeNull();
  });

  it('purges documents across every build id', async () => {
    (await openFake('docket-documents-old')).entries.set('a', new Response('a'));
    (await openFake('docket-documents-new')).entries.set('b', new Response('b'));
    (await openFake('docket-static-new')).entries.set('c', new Response('c'));

    await purgeDocumentCaches();

    expect(caches_.has('docket-documents-old')).toBe(false);
    expect(caches_.has('docket-documents-new')).toBe(false);
    // Build output is not private and is content-hashed; dropping it would be pure waste.
    expect(caches_.has('docket-static-new')).toBe(true);
  });
});

describe('navigateWithDocumentCache', () => {
  const OPTIONS = {
    documentCache: 'docket-documents-build-1',
    offlineCache: 'docket-precache-build-1',
    offlineUrl: '/offline.html',
    timeoutMs: 50,
    giveUpMs: 200,
    origin: ORIGIN,
    online: true,
  } as const;

  /** Seed the precached waiting-room document the worker falls back to. */
  async function seedOfflinePage(): Promise<void> {
    const cache = await caches.open(OPTIONS.offlineCache);
    await cache.put('/offline.html', new Response('<h1>offline</h1>', { status: 200 }));
  }

  function htmlResponse(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  it('stores the document it just served, keyed on the signed-in account', async () => {
    await writeOfflineIdentity('u1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>today</html>'));

    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);

    const cache = await caches.open(OPTIONS.documentCache);
    const stored = await cache.match(documentCacheKey(ORIGIN, '/today', 'u1'));
    expect(await stored?.text()).toBe('<html>today</html>');
  });

  it('stores nothing at all while nobody is signed in', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>sign in</html>'));

    await navigateWithDocumentCache(new Request(`${ORIGIN}/sign-in`), OPTIONS);

    const cache = await openFake(OPTIONS.documentCache);
    expect(cache.entries.size).toBe(0);
  });

  it('brings a previously-visited route back offline instead of the waiting room', async () => {
    await writeOfflineIdentity('u1');
    await seedOfflinePage();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>today</html>'));
    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), {
      ...OPTIONS,
      online: false,
    });

    expect(await offline.text()).toBe('<html>today</html>');
  });

  it('does not touch the network when the browser knows it is offline and the route is cached', async () => {
    await writeOfflineIdentity('u1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>today</html>'));
    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);

    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    network.mockClear();
    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), { ...OPTIONS, online: false });

    // Waiting out the timeout on a device with no radio is the stall offline support exists to
    // remove.
    expect(network).not.toHaveBeenCalled();
  });

  it('falls back to the waiting room for a route never visited', async () => {
    await writeOfflineIdentity('u1');
    await seedOfflinePage();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const response = await navigateWithDocumentCache(new Request(`${ORIGIN}/never-seen`), {
      ...OPTIONS,
      online: false,
    });

    expect(await response.text()).toBe('<h1>offline</h1>');
  });

  it('never serves one account’s shell to another', async () => {
    await writeOfflineIdentity('u1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>u1 workspace</html>'));
    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);
    await seedOfflinePage();

    // Signing in as someone else wipes the cache outright; even if it had not, the key would miss.
    await writeOfflineIdentity('u2');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const response = await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), {
      ...OPTIONS,
      online: false,
    });

    expect(await response.text()).toBe('<h1>offline</h1>');
  });

  it('prefers a still-warm route to a response that has not arrived', async () => {
    await writeOfflineIdentity('u1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse('<html>today</html>'));
    await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);

    // A captive portal: the request is accepted and then never answered.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    const response = await navigateWithDocumentCache(new Request(`${ORIGIN}/today`), OPTIONS);

    expect(await response.text()).toBe('<html>today</html>');
  });

  it('waits for a slow response rather than claiming the person is offline', async () => {
    // The regression this exists for: a route the server took longer than `timeoutMs` to produce
    // used to be answered with the offline page, telling someone with a perfectly good connection
    // that they had none. Observed for real on a first compile; equally reachable on a cold start.
    await writeOfflineIdentity('u1');
    await seedOfflinePage();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(htmlResponse('<html>slow but real</html>'));
          }, 120);
        }),
    );

    const response = await navigateWithDocumentCache(new Request(`${ORIGIN}/slow`), OPTIONS);

    expect(await response.text()).toBe('<html>slow but real</html>');
  });

  it('gives up on a connection that never answers at all', async () => {
    await writeOfflineIdentity('u1');
    await seedOfflinePage();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));

    const response = await navigateWithDocumentCache(new Request(`${ORIGIN}/never-seen`), OPTIONS);

    expect(await response.text()).toBe('<h1>offline</h1>');
  });
});
