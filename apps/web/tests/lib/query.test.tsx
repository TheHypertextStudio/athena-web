/**
 * Behavior tests for the dynamic-data layer in {@link import('../../src/lib/query')}.
 *
 * @remarks
 * These pin the contract the migration phase depends on:
 *
 * - {@link useApiQuery} resolves the parsed Hono RPC body on success and preserves only the
 *   Problem's machine code/status on failure; rendered copy remains caller-owned.
 * - {@link useApiMutation} applies an optimistic cache write through `onMutate`, rolls it back
 *   on failure, and invalidates the related query keys on settle so dependent surfaces refetch.
 *
 * The hooks are exercised against a real {@link QueryClient} (so cache reads/writes and
 * invalidation are genuine) wrapped around the hook under test, with the Hono call replaced by a
 * lightweight typed mock {@link RpcResponse} — no network, no `as any`.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  apiQueryOptions,
  createQueryClient,
  queryKeys,
  SessionExpiredError,
  useApiMutation,
  useApiQuery,
} from '../../src/lib/query';
import { deferred } from '../support/deferred';
import { makeQueryWrapper, okResponse, problemResponse } from '../support/query';

afterEach(cleanup);

/** A minimal project-shaped record for the cache assertions. */
interface ProjectShape {
  id: string;
  name: string;
}

describe('useApiQuery', () => {
  it('resolves the parsed body on a successful Hono RPC call', async () => {
    const { wrapper } = makeQueryWrapper();
    const project: ProjectShape = { id: 'p1', name: 'Alpha' };

    const { result } = renderHook(
      () =>
        useApiQuery(
          apiQueryOptions(
            queryKeys.project('org_1', 'p1'),
            () => Promise.resolve(okResponse(project)),
            'Could not load the project.',
          ),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(project);
    expect(result.current.error).toBeNull();
  });

  it('discards problem prose and retains only structured status/code on a non-OK response', async () => {
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(
      () =>
        useApiQuery(
          apiQueryOptions<ProjectShape>(
            queryKeys.project('org_1', 'p1'),
            () =>
              Promise.resolve(
                problemResponse(
                  'AGENT_MAX_TURNS is not configured; refusing to run agent sessions',
                  409,
                  'conflict',
                ),
              ),
            'Could not load the project.',
          ),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect(result.current.error).toMatchObject({
      message: 'Could not load the project.',
      status: 409,
      code: 'conflict',
    });
    expect(result.current.data).toBeUndefined();
  });

  it('throws a SessionExpiredError on a 401 so the global handler can redirect', async () => {
    const { wrapper } = makeQueryWrapper();

    const { result } = renderHook(
      () =>
        useApiQuery(
          apiQueryOptions<ProjectShape>(
            queryKeys.project('org_1', 'p1'),
            () =>
              Promise.resolve(
                problemResponse('diagnostic session text', 401, 'unauthorized') as never,
              ),
            'Could not load the project.',
          ),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(SessionExpiredError);
  });
});

describe('createQueryClient session-expiry wiring', () => {
  it('invokes the injected onError with a SessionExpiredError when a query 401s', async () => {
    const onError = vi.fn();
    const client = createQueryClient({ onError });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useApiQuery(
          apiQueryOptions<ProjectShape>(
            queryKeys.project('org_1', 'p1'),
            () =>
              Promise.resolve(
                problemResponse('diagnostic session text', 401, 'unauthorized') as never,
              ),
            'Could not load the project.',
          ),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(SessionExpiredError);
    client.clear();
  });

  it('does not retry a 401 (fails fast for the redirect)', async () => {
    const client = createQueryClient();
    const call = vi.fn(() =>
      Promise.resolve(problemResponse('diagnostic session text', 401, 'unauthorized') as never),
    );
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useApiQuery(apiQueryOptions<ProjectShape>(queryKeys.project('org_1', 'p1'), call, 'nope')),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(call).toHaveBeenCalledTimes(1); // no retry
    client.clear();
  });

  it('does not sign the user out for a structured re-authentication 401', async () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useApiQuery(
          apiQueryOptions<ProjectShape>(
            queryKeys.project('org_1', 'p1'),
            () =>
              Promise.resolve(problemResponse('private step-up detail', 401, 'reauth_required')),
            'Verify your identity to continue.',
          ),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect(result.current.error).not.toBeInstanceOf(SessionExpiredError);
    expect(result.current.error).toMatchObject({
      message: 'Verify your identity to continue.',
      code: 'reauth_required',
      status: 401,
    });
  });
});

describe('useApiMutation', () => {
  it('applies an optimistic cache write and invalidates related keys on success', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const listKey = queryKeys.projects('org_1');
    // Seed the list cache so the optimistic write has something to mutate.
    client.setQueryData<readonly ProjectShape[]>(listKey, [{ id: 'p1', name: 'Old name' }]);
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () =>
        useApiMutation<
          ProjectShape,
          { id: string; name: string },
          { previous?: readonly ProjectShape[] }
        >({
          mutationFn: (vars) => Promise.resolve(okResponse<ProjectShape>(vars).json()),
          invalidateKeys: [listKey],
          onMutate: (vars) => {
            const previous = client.getQueryData<readonly ProjectShape[]>(listKey);
            client.setQueryData<readonly ProjectShape[]>(listKey, (current) =>
              (current ?? []).map((p) => (p.id === vars.id ? { ...p, name: vars.name } : p)),
            );
            return { previous };
          },
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ id: 'p1', name: 'New name' });
    });

    // Optimistic write landed in the cache.
    expect(client.getQueryData<readonly ProjectShape[]>(listKey)).toEqual([
      { id: 'p1', name: 'New name' },
    ]);
    // Related key was invalidated on settle so dependent surfaces refetch.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: listKey });
  });

  it('settles as soon as the write lands, without waiting for the refetch it triggers', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const listKey = queryKeys.projects('org_1');
    const refetchStarted = deferred<undefined>();
    const releaseRefetch = deferred<undefined>();
    // Held only once the write is in flight, so an incidental mount refetch cannot be mistaken
    // for the one the invalidation triggers.
    let holdNextRead = false;
    renderHook(
      () =>
        useApiQuery(
          apiQueryOptions(
            listKey,
            async () => {
              if (holdNextRead) {
                refetchStarted.resolve(undefined);
                await releaseRefetch.promise;
              }
              return okResponse<readonly ProjectShape[]>([{ id: 'p1', name: 'Server name' }]);
            },
            'Could not load.',
          ),
        ),
      { wrapper },
    );
    await waitFor(() => {
      expect(client.getQueryData(listKey)).toBeDefined();
    });

    const { result } = renderHook(
      () =>
        useApiMutation<ProjectShape, { id: string; name: string }>({
          mutationFn: (vars) => Promise.resolve(okResponse<ProjectShape>(vars).json()),
          invalidateKeys: [listKey],
        }),
      { wrapper },
    );

    holdNextRead = true;
    act(() => {
      result.current.mutate({ id: 'p1', name: 'New name' });
    });
    await refetchStarted.promise;
    // Long enough for the write to settle if nothing is holding it, while the refetch it kicked
    // off is still deliberately unfinished.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // The write is done; the reconciling read is not, and is nobody's business but the cache's.
    // Awaiting it here is what kept `isPending` true — and every control bound to it disabled,
    // every composer frozen — for a second round trip after the change was already saved.
    expect(result.current.isPending).toBe(false);
    releaseRefetch.resolve(undefined);
  });

  it('holds the write open when a caller opts into awaiting the refetch', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const listKey = queryKeys.projects('org_1');
    const refetchStarted = deferred<undefined>();
    const releaseRefetch = deferred<undefined>();
    let holdNextRead = false;
    renderHook(
      () =>
        useApiQuery(
          apiQueryOptions(
            listKey,
            async () => {
              if (holdNextRead) {
                refetchStarted.resolve(undefined);
                await releaseRefetch.promise;
              }
              return okResponse<readonly ProjectShape[]>([{ id: 'p1', name: 'Server name' }]);
            },
            'Could not load.',
          ),
        ),
      { wrapper },
    );
    await waitFor(() => {
      expect(client.getQueryData(listKey)).toBeDefined();
    });

    const { result } = renderHook(
      () =>
        useApiMutation<ProjectShape, { id: string; name: string }>({
          mutationFn: (vars) => Promise.resolve(okResponse<ProjectShape>(vars).json()),
          invalidateKeys: [listKey],
          awaitInvalidation: true,
        }),
      { wrapper },
    );

    holdNextRead = true;
    act(() => {
      result.current.mutate({ id: 'p1', name: 'New name' });
    });
    await refetchStarted.promise;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // The escape hatch for a caller that genuinely must not proceed until the refreshed data is
    // on the client. It has to keep working, or "opt in" means nothing.
    expect(result.current.isPending).toBe(true);
    releaseRefetch.resolve(undefined);
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });

  it('still reconciles the cache with the server after settling', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const listKey = queryKeys.projects('org_1');
    renderHook(
      () =>
        useApiQuery(
          apiQueryOptions(
            listKey,
            () =>
              Promise.resolve(
                okResponse<readonly ProjectShape[]>([{ id: 'p1', name: 'Server name' }]),
              ),
            'Could not load.',
          ),
        ),
      { wrapper },
    );

    const { result } = renderHook(
      () =>
        useApiMutation<ProjectShape, { id: string; name: string }>({
          mutationFn: (vars) => Promise.resolve(okResponse<ProjectShape>(vars).json()),
          invalidateKeys: [listKey],
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ id: 'p1', name: 'New name' });
    });

    // Not awaiting the refetch changes when the caller is released, not whether the
    // reconciliation happens.
    await waitFor(() => {
      expect(client.getQueryData<readonly ProjectShape[]>(listKey)).toEqual([
        { id: 'p1', name: 'Server name' },
      ]);
    });
  });

  it('rolls back the optimistic write via onError when the mutation fails', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const listKey = queryKeys.projects('org_1');
    const seed: readonly ProjectShape[] = [{ id: 'p1', name: 'Old name' }];
    client.setQueryData<readonly ProjectShape[]>(listKey, seed);

    const { result } = renderHook(
      () =>
        useApiMutation<
          ProjectShape,
          { id: string; name: string },
          { previous?: readonly ProjectShape[] }
        >({
          // Reject to simulate a failed write (the unwrap layer throws on non-OK in real use).
          mutationFn: () => Promise.reject(new Error('Could not update the project.')),
          invalidateKeys: [listKey],
          onMutate: (vars) => {
            const previous = client.getQueryData<readonly ProjectShape[]>(listKey);
            client.setQueryData<readonly ProjectShape[]>(listKey, (current) =>
              (current ?? []).map((p) => (p.id === vars.id ? { ...p, name: vars.name } : p)),
            );
            return { previous };
          },
          onError: (_error, _vars, context) => {
            if (context?.previous) {
              client.setQueryData<readonly ProjectShape[]>(listKey, context.previous);
            }
          },
        }),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'p1', name: 'New name' })).rejects.toThrow(
        'Could not update the project.',
      );
    });

    // Rolled back to the pre-mutation snapshot (onError restores the cache before the reject).
    expect(client.getQueryData<readonly ProjectShape[]>(listKey)).toEqual(seed);
    // The mutation observer's error state flushes asynchronously after the rejection settles,
    // so wait for it rather than reading the snapshot synchronously.
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe('Could not update the project.');
  });
});
