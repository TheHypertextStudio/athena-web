'use client';

/**
 * The dynamic-data layer for the Docket product app — a thin, fully-typed wrapper around
 * TanStack Query v5 and the Hono RPC {@link api} client. This module is the public entry point: it
 * re-exports the server-safe core ({@link STALE}, {@link apiQueryOptions}, {@link unwrap},
 * {@link createQueryClient}) from `query-core.ts` and adds the client-only React hooks.
 *
 * @remarks
 * Every data surface used to hand-roll `useEffect` + `useState` + a manual `load()`/`refresh()`,
 * which left data stale and forced dead "Refresh"/"Plan day" buttons that only re-pulled. This
 * module is the single contract those surfaces migrate onto:
 *
 * - {@link apiQueryOptions} (from `query-core`) builds a **typed query definition** (key + fetcher +
 *   optional {@link STALE} tier) whose key carries its data type, so reads, prefetches, and cache
 *   writes (`setQueryData`) are all type-checked against the response shape.
 * - {@link useApiQuery} is the read hook: hand it a definition and it resolves the parsed body,
 *   surfacing the server's `application/problem+json` message as `error`/`isError`.
 *   {@link useApiListQuery} adds `keepPreviousData` for flicker-free lists, and
 *   {@link useLiveApiQuery} layers a focus-only `refetchInterval` for session/agent-activity polling.
 * - {@link useApiMutation} is the write hook. It supports an optimistic cache update (via
 *   {@link optimisticPatch}) with automatic rollback on failure, and invalidates a set of related
 *   {@link QueryKey}s on settle so dependent surfaces re-fetch.
 *
 * The query-key convention lives in {@link queryKeys}: every key is org-scoped and hierarchical,
 * so invalidating a coarse key (e.g. an org's projects list) is a prefix match that also covers
 * finer keys (a single project's detail). All of it is typed off the Hono client's response
 * shapes via generics — no `as any`, no placeholder types.
 *
 * @see `docs/engineering/specs/data-layer.md` for the full standard (the seven rules, tiers,
 * optimistic recipe, prefetch/prime, SSR hydration, and pitfalls).
 * @see {@link api} for the underlying typed Hono RPC client.
 */
import { useCallback } from 'react';

import {
  type DefaultError,
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { ApiInfiniteDef } from './query-core';

export * from './query-core';
export { queryKeys } from './query-keys';

/**
 * Read hook: subscribe a component to a typed query {@link apiQueryOptions | definition}.
 *
 * @remarks
 * The one read primitive — always pass a definition from {@link apiQueryOptions} (key + fetcher +
 * optional {@link STALE} tier). The hook's `data` is the parsed body and its `error` carries the
 * server's problem message on failure (the error handling lives in the definition's query fn). It
 * inherits the {@link createQueryClient} defaults (refetch-on-focus, one retry), so the surface
 * stays fresh without a manual refresh button.
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @returns the {@link UseQueryResult} for the parsed body.
 */
export function useApiQuery<T>(def: UseQueryOptions<T>): UseQueryResult<T> {
  return useQuery(def);
}

/**
 * Read hook for LIST surfaces — {@link useApiQuery} that keeps the previous data on screen while a
 * refetch is in flight (filter change, pagination, focus refetch) instead of blanking to a
 * skeleton. Use this for every list/table query so the UI never flickers; the first ever load
 * still shows the loading state (there is nothing to keep yet).
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @returns the {@link UseQueryResult} for the parsed body.
 */
export function useApiListQuery<T>(def: UseQueryOptions<T>): UseQueryResult<T> {
  return useApiQuery({ placeholderData: keepPreviousData, ...def });
}

/**
 * Live read hook: a {@link useApiQuery} that polls on an interval.
 *
 * @remarks
 * For surfaces whose data changes out-of-band — agent activity, an in-flight session — where
 * focus-only refetch is not enough. It layers a `refetchInterval` on top of {@link useApiQuery},
 * and (via `refetchIntervalInBackground: false`, TanStack's default) only polls while the tab is
 * focused, so a backgrounded tab does not burn requests.
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @param intervalMs - The polling interval in milliseconds.
 * @returns the {@link UseQueryResult} for the parsed body.
 */
export function useLiveApiQuery<T>(def: UseQueryOptions<T>, intervalMs: number): UseQueryResult<T> {
  return useApiQuery({ refetchInterval: intervalMs, ...def });
}

/**
 * Read hook for CURSOR-PAGINATED surfaces — subscribe to an {@link apiInfiniteQueryOptions}
 * definition. The Stream firehose's one read primitive: `data.pages` holds each fetched page,
 * and `fetchNextPage()`/`hasNextPage` drive infinite scroll off the page's `nextCursor`.
 *
 * @typeParam TPage - The page response shape (carried by the definition).
 * @param def - A typed definition from {@link apiInfiniteQueryOptions}.
 * @returns the {@link UseInfiniteQueryResult} over `InfiniteData<TPage>`.
 */
export function useInfiniteApiQuery<TPage>(
  def: ApiInfiniteDef<TPage>,
): UseInfiniteQueryResult<InfiniteData<TPage>> {
  return useInfiniteQuery(def);
}

/**
 * Live cursor-paginated read: {@link useInfiniteApiQuery} that polls page 1 on an interval
 * (focus-gated, like {@link useLiveApiQuery}). The Stream's polling-now / SSE-later seam — the
 * interval is the only thing that changes when SSE lands.
 *
 * @typeParam TPage - The page response shape (carried by the definition).
 * @param def - A typed definition from {@link apiInfiniteQueryOptions}.
 * @param intervalMs - The polling interval in milliseconds.
 * @returns the {@link UseInfiniteQueryResult} over `InfiniteData<TPage>`.
 */
export function useLiveInfiniteApiQuery<TPage>(
  def: ApiInfiniteDef<TPage>,
  intervalMs: number,
): UseInfiniteQueryResult<InfiniteData<TPage>> {
  return useInfiniteQuery({ ...def, refetchInterval: intervalMs });
}

/**
 * Returns a prefetch function that warms a query {@link apiQueryOptions | definition} into the
 * cache — call it on a row's hover/focus (`onMouseEnter`/`onFocus`) so the subsequent navigation
 * renders from cache instead of fetching after paint. Pass the SAME definition the destination
 * reads with, so there is one source of truth. A no-op when the data is already fresh.
 *
 * @returns a `(def) => void` prefetcher bound to the active query client.
 */
export function usePrefetchApi(): <T>(def: UseQueryOptions<T, DefaultError, T>) => void {
  const queryClient = useQueryClient();
  // Stable identity (only `queryClient` is captured) so callers can list the prefetcher in effect
  // deps without the effect refiring every render.
  return useCallback(
    <T>(def: UseQueryOptions<T, DefaultError, T>) => {
      void queryClient.prefetchQuery(def);
    },
    [queryClient],
  );
}

/** Options for {@link useApiMutation}. */
export interface ApiMutationOptions<TData, TVariables, TContext> extends Omit<
  UseMutationOptions<TData, DefaultError, TVariables, TContext>,
  'mutationFn'
> {
  /**
   * Query keys to invalidate once the mutation settles (success or rollback).
   *
   * @remarks
   * Each key is matched by prefix, so passing a list key (e.g. `queryKeys.projects(orgId)`)
   * also refetches every detail key beneath it. Pass the keys for every surface the write
   * affects so they re-fetch the authoritative server state.
   */
  invalidateKeys?: readonly QueryKey[];
}

/**
 * Write hook: a typed Hono RPC mutation with optimistic update, rollback, and invalidation.
 *
 * @remarks
 * The single contract for every create/update/delete. Provide a `mutationFn` (typically wrapping
 * one Hono RPC call through {@link unwrap}) and, optionally:
 *
 * - an `onMutate(variables, context)` that applies an optimistic cache change and returns the
 *   rollback snapshot (`TContext`);
 * - an `onError(error, variables, onMutateResult, context)` where `onMutateResult` is that
 *   rollback snapshot, used to restore the pre-mutation cache (TanStack Query v5 callback arity);
 * - `invalidateKeys`, the related keys to refetch on settle.
 *
 * Invalidation runs in `onSettled` after any caller-supplied `onSettled`, so a successful write
 * reconciles the optimistic cache with the server's response and a failed one repairs it. All
 * generics are inferred from `mutationFn`, so the variables and result stay fully typed.
 *
 * @typeParam TData - The mutation result type (inferred from `mutationFn`).
 * @typeParam TVariables - The mutation input type (inferred from `mutationFn`).
 * @typeParam TContext - The rollback context returned by `onMutate`.
 * @param options - The mutation behavior, including `mutationFn` and optional `invalidateKeys`.
 * @returns the {@link UseMutationResult}.
 */
export function useApiMutation<TData, TVariables, TContext = unknown>(
  options: ApiMutationOptions<TData, TVariables, TContext> & {
    mutationFn: (variables: TVariables) => Promise<TData>;
  },
): UseMutationResult<TData, DefaultError, TVariables, TContext> {
  const queryClient = useQueryClient();
  const { invalidateKeys, onSettled, ...rest } = options;
  return useMutation<TData, DefaultError, TVariables, TContext>({
    ...rest,
    onSettled: async (data, error, variables, onMutateResult, context) => {
      await onSettled?.(data, error, variables, onMutateResult, context);
      if (invalidateKeys && invalidateKeys.length > 0) {
        await Promise.all(
          invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
        );
      }
    },
  });
}

/**
 * Optimistically patch one cached query and return a rollback — the easy path for making a write
 * feel instant. Call it from a {@link useApiMutation} `onMutate` and return its result as the
 * mutation context; call `rollback()` from `onError` to restore the pre-mutation cache if the
 * server rejects the write. Pair with `invalidateKeys` so the cache reconciles with the server on
 * settle. No-ops when the query is not cached yet.
 *
 * @example
 * ```ts
 * useApiMutation({
 *   mutationFn: (vars) => unwrap(() => api.v1.orgs[':orgId'].tasks[':id'].$patch(...), '…'),
 *   onMutate: (vars) =>
 *     optimisticPatch<TaskOut>(queryClient, queryKeys.task(orgId, vars.id), (prev) => ({
 *       ...prev,
 *       state: vars.state,
 *     })),
 *   onError: (_e, _vars, ctx) => ctx?.rollback(),
 *   invalidateKeys: [queryKeys.task(orgId, id)],
 * });
 * ```
 *
 * @typeParam T - The cached data type at `key`.
 * @param queryClient - The active client (from `useQueryClient`).
 * @param key - The query key to patch.
 * @param recipe - Pure function producing the next cached value from the previous one.
 * @returns `{ rollback }` restoring the snapshot taken before the patch.
 */
export function optimisticPatch<T>(
  queryClient: QueryClient,
  key: QueryKey,
  recipe: (previous: T) => T,
): { rollback: () => void } {
  const previous = queryClient.getQueryData<T>(key);
  if (previous !== undefined) queryClient.setQueryData<T>(key, recipe(previous));
  return {
    rollback: () => {
      queryClient.setQueryData<T>(key, previous);
    },
  };
}
