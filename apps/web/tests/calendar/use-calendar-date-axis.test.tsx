import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { itemsGet, layersGet } = vi.hoisted(() => ({
  itemsGet: vi.fn(),
  layersGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          items: { $get: itemsGet },
          layers: { $get: layersGet },
        },
      },
    },
  },
}));

import { useCalendarDateAxis } from '../../src/app/(app)/calendar/use-calendar-date-axis';

/** A typed-enough mock Hono response for the calendar query unwrap layer. */
function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** Fresh QueryClient wrapper for one rolling-window hook contract. */
function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  itemsGet.mockReset();
  layersGet.mockReset().mockResolvedValue(okResponse({ items: [] }));
});

afterEach(cleanup);

describe('useCalendarDateAxis rolling navigation', () => {
  it('exposes a retry action that refreshes failed calendar reads in place', async () => {
    itemsGet
      .mockRejectedValueOnce(new Error('hostile internal calendar failure'))
      .mockResolvedValueOnce(okResponse({ layers: [], items: [] }));

    const { result } = renderHook(() => useCalendarDateAxis('2026-07-13', 1, 'UTC'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.itemsError).toBe(true);
    });
    expect(typeof result.current.retry).toBe('function');

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(itemsGet).toHaveBeenCalledTimes(2);
      expect(result.current.itemsError).toBe(false);
    });
  });

  it('uses the same retry action when calendar-layer controls fail to load', async () => {
    itemsGet.mockResolvedValue(okResponse({ layers: [], items: [] }));
    layersGet
      .mockRejectedValueOnce(new Error('hostile internal layer failure'))
      .mockResolvedValueOnce(okResponse({ items: [] }));

    const { result } = renderHook(() => useCalendarDateAxis('2026-07-13', 1, 'UTC'), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.layersError).toBe(true);
    });
    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(layersGet).toHaveBeenCalledTimes(2);
      expect(result.current.layersError).toBe(false);
    });
  });

  it('reports retained placeholder rows as loading for the next range', async () => {
    let resolveNextRange: ((response: ReturnType<typeof okResponse>) => void) | undefined;
    itemsGet.mockResolvedValueOnce(okResponse({ layers: [], items: [] })).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNextRange = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ anchorDate }) => useCalendarDateAxis(anchorDate, 1, 'UTC'),
      { initialProps: { anchorDate: '2026-07-13' }, wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.itemsPending).toBe(false);
    });

    rerender({ anchorDate: '2026-07-14' });

    await waitFor(() => {
      expect(itemsGet).toHaveBeenCalledTimes(2);
    });
    expect(result.current.startISO).toBe('2026-07-13T00:00:00Z');
    expect(result.current.items).toEqual([]);
    expect(result.current.itemsPending).toBe(true);

    act(() => {
      resolveNextRange?.(okResponse({ layers: [], items: [] }));
    });
    await waitFor(() => {
      expect(result.current.itemsPending).toBe(false);
    });
  });
});
