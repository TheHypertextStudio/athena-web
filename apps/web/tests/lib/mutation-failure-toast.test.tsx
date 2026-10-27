import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueuedOfflineWriteError } from '@/components/pwa/offline-write';
import { useApiMutation } from '@/lib/query';
import { unwrap } from '@/lib/query-core';

import { makeQueryWrapper, problemResponse } from '../support/query';

afterEach(() => {
  dismissAllNotices();
  cleanup();
  vi.useRealTimers();
});

/** A query wrapper that also mounts the notice stack. */
function wrapperWithToaster(): (props: { readonly children: ReactNode }) => JSX.Element {
  const { client } = makeQueryWrapper();
  return function Wrapper({ children }: { readonly children: ReactNode }): JSX.Element {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  };
}

/** A write that the API refuses with a retryable problem. */
function failingWrite(): Promise<never> {
  return unwrap(
    () => Promise.resolve(problemResponse('server detail', 500, 'internal')),
    'Could not save the title.',
  ) as Promise<never>;
}

describe('useApiMutation failure presentation', () => {
  it('presents a rejected write once as a notice, after the caller rolls back', async () => {
    const order: string[] = [];
    const { result } = renderHook(
      () =>
        useApiMutation<never, string>({
          mutationFn: failingWrite,
          onError: () => {
            order.push('rollback');
          },
        }),
      { wrapper: wrapperWithToaster() },
    );

    await act(async () => {
      await result.current.mutateAsync('title').catch(() => undefined);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/server detail/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(order).toEqual(['rollback']);
  });

  it('re-issues the same write from Try again', async () => {
    const mutationFn = vi.fn(failingWrite);
    const { result } = renderHook(() => useApiMutation<never, string>({ mutationFn }), {
      wrapper: wrapperWithToaster(),
    });

    await act(async () => {
      await result.current.mutateAsync('title').catch(() => undefined);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledTimes(2);
    });
    expect(mutationFn).toHaveBeenLastCalledWith('title');
  });

  it('retains an interrupted upload retry until acted on, with its original file and identity', async () => {
    vi.useFakeTimers();
    const file = new File(['123456789'], 'report.txt');
    const variables = { file, requestId: 'same-reservation' };
    const mutationFn = vi.fn(async (_input: typeof variables) => failingWrite());
    const { result } = renderHook(() => useApiMutation({ mutationFn }), {
      wrapper: wrapperWithToaster(),
    });
    await act(async () => {
      await result.current.mutateAsync(variables).catch(() => undefined);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(mutationFn.mock.calls[1]?.[0]).toBe(variables);
  });

  it('keeps distinct failed writes recoverable when they have the same failure code', async () => {
    const mutationFn = vi.fn(async (_input: string) => failingWrite());
    const { result } = renderHook(() => useApiMutation<never, string>({ mutationFn }), {
      wrapper: wrapperWithToaster(),
    });
    await act(async () => {
      await result.current.mutateAsync('first').catch(() => undefined);
      await result.current.mutateAsync('second').catch(() => undefined);
    });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2);
    });
    const retries = screen.getAllByRole('button', { name: 'Try again' });
    for (const button of retries) fireEvent.click(button);
    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledTimes(4);
    });
    expect(
      mutationFn.mock.calls
        .slice(2)
        .map(([input]) => input)
        .sort(),
    ).toEqual(['first', 'second']);
  });

  it('stays quiet when the caller owns presentation', async () => {
    const { result } = renderHook(
      () => useApiMutation<never, string>({ mutationFn: failingWrite, failure: 'silent' }),
      { wrapper: wrapperWithToaster() },
    );

    await act(async () => {
      await result.current.mutateAsync('title').catch(() => undefined);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a queued offline write as a calm status, never a failure', async () => {
    const onError = vi.fn();
    const { result } = renderHook(
      () =>
        useApiMutation<never, string>({
          mutationFn: () => Promise.reject(new QueuedOfflineWriteError('entry_1')),
          onError,
        }),
      { wrapper: wrapperWithToaster() },
    );

    await act(async () => {
      await result.current.mutateAsync('title').catch(() => undefined);
    });

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });
});
