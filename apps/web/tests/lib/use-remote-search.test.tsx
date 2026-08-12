/**
 * Behaviour tests for {@link useRemoteSearch}.
 *
 * @remarks
 * This hook replaced five hand-rolled copies of the same mechanism, three of which had no test
 * coverage at all. These pin the invariants those copies had encoded only in their prose — most
 * importantly the two that a naive shared hook would have quietly broken: an empty term is a
 * legitimate search (the command palette browses recents with one), and a term below `minChars`
 * is *not pending* rather than pending-forever.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRemoteSearch } from '@/lib/use-remote-search';

import { makeQueryWrapper, okResponse } from '../support/query';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Advance past the debounce and let React commit the result.
 *
 * @remarks
 * Two flushes on purpose. The first fires the debounce timer and resolves the fetch; the query
 * cache's resulting state update needs a second turn before React has committed the new render.
 * One flush leaves `data` on the previous wave, which reads exactly like a `keepPreviousData` bug.
 */
async function settle(ms = 300): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** The shape every spy fetcher in this file satisfies. */
type FetchSpy = (term: string) => Promise<unknown>;

/** Render the hook against a spy fetcher, with the query key keyed off the term. */
function renderSearch(
  fetchSpy: FetchSpy,
  overrides: { minChars?: number; enabled?: boolean } = {},
) {
  const { wrapper } = makeQueryWrapper();
  return renderHook(
    ({ query }: { query: string }) =>
      useRemoteSearch<{ items: string[] }>({
        query,
        debounceMs: 200,
        key: (term) => ['probe', term],
        fetch: (term) => fetchSpy(term) as Promise<never>,
        fallbackMessage: 'Could not search.',
        ...overrides,
      }),
    { wrapper, initialProps: { query: '' } },
  );
}

describe('useRemoteSearch', () => {
  it('collapses a keystroke burst into one request for the settled term', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(() => Promise.resolve(okResponse({ items: ['hit'] })));
    const { rerender } = renderSearch(fetchSpy);

    // The empty first term issues its own request; everything after must collapse to one.
    await settle();
    fetchSpy.mockClear();

    rerender({ query: 'r' });
    rerender({ query: 'ro' });
    rerender({ query: 'roa' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('roa');
  });

  it('searches for the empty term, because browsing is a legitimate request', async () => {
    // The constraint most at risk in the extraction: the command palette shows recents when
    // nothing has been typed. A hook that gated on a non-empty term would have broken it silently.
    const fetchSpy = vi.fn(() => Promise.resolve(okResponse({ items: ['recent'] })));
    renderSearch(fetchSpy);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('');
    });
  });

  it('issues nothing below minChars, and reports not-pending rather than pending-forever', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okResponse({ items: [] })));
    const { result, rerender } = renderSearch(fetchSpy, { minChars: 2 });

    rerender({ query: 'a' });
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    rerender({ query: 'ab' });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('ab');
    });
  });

  it('issues nothing while disabled', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(okResponse({ items: [] })));
    const { result, rerender } = renderSearch(fetchSpy, { enabled: false });

    rerender({ query: 'anything' });
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('counts the mid-burst window as pending', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(() => Promise.resolve(okResponse({ items: ['hit'] })));
    const { result, rerender } = renderSearch(fetchSpy);

    // Settle the initial wave. No `waitFor` — it deadlocks against fake timers.
    await settle();
    expect(result.current.pending).toBe(false);

    // Typed, but not yet settled: the visible results belong to the previous term, so a surface
    // that reported "settled" here would be claiming an answer it does not have.
    rerender({ query: 'road' });
    expect(result.current.pending).toBe(true);
  });

  it('holds the previous wave rather than blanking while the next one lands', async () => {
    vi.useFakeTimers();
    // The second term's response is held open deliberately, so the assertion lands in the window
    // this test is about rather than wherever the scheduler happened to leave it.
    let releaseSecond = (): void => undefined;
    const fetchSpy = vi.fn((term: string) =>
      term === 'second'
        ? new Promise((resolve) => {
            releaseSecond = () => {
              resolve(okResponse({ items: ['second'] }));
            };
          })
        : Promise.resolve(okResponse({ items: [term] })),
    );
    const { result, rerender } = renderSearch(fetchSpy);

    rerender({ query: 'first' });
    await settle();
    expect(result.current.data).toEqual({ items: ['first'] });

    rerender({ query: 'second' });
    await settle();
    // `keepPreviousData` from useApiListQuery: mid-flight, the previous term's rows are still on
    // screen. Without it the list empties and refills on every settled keystroke.
    expect(result.current.pending).toBe(true);
    expect(result.current.data).toEqual({ items: ['first'] });

    await act(async () => {
      releaseSecond();
    });
    await settle(0);
    expect(result.current.data).toEqual({ items: ['second'] });
  });

  it('reports a failure as application-owned copy, never the provider’s own words', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ title: 'ECONNRESET at upstream.internal' }),
      }),
    );
    const { result } = renderSearch(fetchSpy);

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.error).toBe('Could not search.');
    expect(result.current.error).not.toContain('ECONNRESET');
  });
});
