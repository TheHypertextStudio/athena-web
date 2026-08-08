import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The update handshake inside the worker — the half of the exchange the page cannot see.
 *
 * @remarks
 * `sw.ts` registers its listeners at module scope against `self`, so these tests install a fake
 * `ServiceWorkerGlobalScope` (and the build-time `__SW_*` constants) before importing the module
 * once, then drive the captured handlers directly. The point under test is the activation
 * invariant: `clients.claim()` is what fires `controllerchange` in open tabs, so it must run even
 * when cache eviction fails — otherwise an accepted update strands every tab behind a Reload
 * button that does nothing.
 */

type Handler = (event: unknown) => void;

const handlers = new Map<string, Handler>();

const skipWaiting = vi.fn(() => Promise.resolve());
const claim = vi.fn(() => Promise.resolve());

/** The caches surface `activate` touches. Reassigned per test. */
const fakeCaches = {
  keys: vi.fn<() => Promise<string[]>>(() => Promise.resolve([])),
  delete: vi.fn<(name: string) => Promise<boolean>>(() => Promise.resolve(true)),
  open: vi.fn(() =>
    Promise.resolve({
      addAll: () => Promise.resolve(),
      match: () => Promise.resolve(undefined),
    }),
  ),
};

/** Run a captured listener with a waitUntil-capturing event and await its extended lifetime. */
async function dispatch(name: string, event: Record<string, unknown> = {}): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    throw new Error(`no ${name} handler registered`);
  }
  let extended: Promise<unknown> = Promise.resolve();
  handler({
    ...event,
    waitUntil: (promise: Promise<unknown>) => {
      extended = promise;
    },
  });
  await extended;
}

beforeAll(async () => {
  Object.assign(globalThis, {
    __SW_BUILD_ID__: 'testbuild',
    __SW_MODE__: 'production',
    __SW_API_ORIGIN__: 'https://api.docket.test',
    // Empty on purpose: `activate` fires warmBuildAssets, and an empty precache list makes it a
    // no-op so activation tests exercise eviction + claim and nothing else.
    __SW_PRECACHE__: [],
    caches: fakeCaches,
    self: {
      addEventListener: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
      skipWaiting,
      clients: { claim },
      location: { origin: 'https://docket.test' },
      navigator: { onLine: true },
      registration: {},
    },
  });
  await import('../src/worker/sw');
});

beforeEach(() => {
  skipWaiting.mockClear();
  claim.mockClear();
  fakeCaches.keys.mockReset();
  fakeCaches.keys.mockResolvedValue([]);
  fakeCaches.delete.mockReset();
  fakeCaches.delete.mockResolvedValue(true);
});

describe('activate', () => {
  it('evicts docket-* caches from other versions and leaves everything else alone', async () => {
    fakeCaches.keys.mockResolvedValue([
      'docket-precache-oldbuild',
      'docket-precache-testbuild',
      'docket-identity',
      'unrelated-cache',
    ]);
    await dispatch('activate');
    expect(fakeCaches.delete.mock.calls.map(([name]) => name)).toEqual([
      'docket-precache-oldbuild',
    ]);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('still claims open tabs when eviction fails outright', async () => {
    fakeCaches.keys.mockRejectedValue(new Error('storage denied'));
    await dispatch('activate');
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('still claims open tabs when a single delete rejects', async () => {
    fakeCaches.keys.mockResolvedValue(['docket-static-oldbuild']);
    fakeCaches.delete.mockRejectedValue(new Error('quota'));
    await dispatch('activate');
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('message', () => {
  it('activates on SKIP_WAITING', async () => {
    await dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown and malformed payloads', async () => {
    await dispatch('message', { data: { type: 'NOT_A_THING' } });
    await dispatch('message', { data: null });
    await dispatch('message', { data: 'SKIP_WAITING' });
    expect(skipWaiting).not.toHaveBeenCalled();
  });
});
