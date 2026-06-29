'use client';

/**
 * The dynamic-data layer for the Docket product app — a thin, fully-typed wrapper around
 * TanStack Query v5 and the Hono RPC {@link api} client.
 *
 * @remarks
 * Every data surface used to hand-roll `useEffect` + `useState` + a manual `load()`/`refresh()`,
 * which left data stale and forced dead "Refresh"/"Plan day" buttons that only re-pulled. This
 * module is the single contract those surfaces migrate onto:
 *
 * - {@link createQueryClient} builds the one stable {@link QueryClient} (mounted once in
 *   `providers.tsx`) with the app-wide defaults: a `30s` stale time, auto-refetch on window
 *   focus, and a single retry. Surfaces become live without a manual refresh control.
 * - {@link useApiQuery} is the read hook. It takes a {@link QueryKey} and a thunk that performs
 *   one Hono RPC call, and resolves the parsed body — throwing a readable error (via
 *   {@link readProblem}/{@link readError}) on a non-OK response so TanStack's `error`/`isError`
 *   state carries the server's own message.
 * - {@link useLiveApiQuery} is the same read hook with a `refetchInterval`, for session/
 *   agent-activity polling.
 * - {@link useApiMutation} is the write hook. It supports an optimistic cache update with
 *   automatic rollback on failure, and invalidates a set of related {@link QueryKey}s on settle
 *   so dependent surfaces re-fetch.
 *
 * The query-key convention lives in {@link queryKeys}: every key is org-scoped and hierarchical,
 * so invalidating a coarse key (e.g. an org's projects list) is a prefix match that also covers
 * finer keys (a single project's detail). All of it is typed off the Hono client's response
 * shapes via generics — no `as any`, no placeholder types.
 *
 * @see {@link api} for the underlying typed Hono RPC client.
 */
import {
  type DefaultError,
  keepPreviousData,
  QueryClient,
  type QueryKey,
  queryOptions,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { readError, readProblem } from '@/lib/problem';

export { queryKeys } from './query-keys';

/**
 * Staleness tiers (ms). Every query picks one based on how fast its data changes, rather than a
 * single flat default: `standard` is the {@link createQueryClient} default; pass
 * `{ staleTime: STALE.volatile }` to {@link useApiQuery} for fast-moving data (task state,
 * in-flight sessions, counts) and `STALE.static` for data that rarely changes within a session
 * (members, teams, vocabulary, roles). See `docs/engineering/specs/data-layer.md`.
 */
export const STALE = {
  /** Always considered stale — refetch eagerly (poll targets / hyper-volatile reads). */
  realtime: 0,
  /** Fast-moving: task state, in-flight sessions, pending counts. */
  volatile: 5_000,
  /** The default for most lists and detail reads. */
  standard: 30_000,
  /** Rarely changes within a session: members, teams, vocabulary, roles. */
  static: 300_000,
} as const;

/** How long an unused query stays cached before GC — long enough that back-nav stays instant. */
const DEFAULT_GC_TIME_MS = 5 * 60_000;

/**
 * Build the single, stable {@link QueryClient} for the app.
 *
 * @remarks
 * Called once via a `useState` lazy initializer in `providers.tsx` so the client survives
 * re-renders and never leaks across requests. The defaults make every surface dynamic by
 * default: `staleTime` of 30s avoids refetch storms while keeping data live, `refetchOnWindowFocus`
 * pulls fresh data when the user returns to the tab (replacing manual "Refresh" buttons), and a
 * single `retry` smooths a transient network blip without hammering a genuinely-down endpoint.
 *
 * @returns a configured {@link QueryClient}.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.standard,
        gcTime: DEFAULT_GC_TIME_MS,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

/**
 * The minimal structural shape this layer needs from a Hono RPC response.
 *
 * @remarks
 * The Hono client returns a `ClientResponse<T>` whose `.json()` resolves to the typed body `T`.
 * Constraining to this minimal interface (rather than Hono's deep internal `ClientResponse`
 * generic) keeps the hooks ergonomic and lets tests pass a lightweight mock, while `T` is still
 * inferred end-to-end from the real client call — so there is no loss of type safety and no
 * `as any`. The real `Response` is structurally assignable to it.
 */
export interface RpcResponse<T> {
  /** Whether the request succeeded (HTTP 2xx). */
  readonly ok: boolean;
  /** The HTTP status code. */
  readonly status: number;
  /** Parse the JSON body as the typed payload `T`. */
  json(): Promise<T>;
}

/**
 * Await a Hono RPC call and return its parsed body, throwing a readable error on failure.
 *
 * @remarks
 * The bridge between the Hono RPC convention (a `Response` whose `.ok` is checked, with errors
 * emitted as `application/problem+json`) and TanStack Query's throw-to-signal-error convention.
 * On a non-OK response it throws an `Error` whose message is the server's problem `detail`/`title`
 * (via {@link readProblem}); the thrown value flows into the hook's `error` state. A rejection from
 * the call itself (network failure) is re-thrown with a readable message via {@link readError}.
 *
 * @typeParam T - The parsed response body type, inferred from the Hono client call.
 * @param call - A thunk performing exactly one Hono RPC call.
 * @param fallbackMessage - The message to surface when the server sends no problem detail.
 * @returns the parsed response body.
 * @throws {Error} when the response is non-OK or the request rejects.
 */
export async function unwrap<T>(
  call: () => Promise<RpcResponse<T>>,
  fallbackMessage: string,
): Promise<T> {
  let response: RpcResponse<T>;
  try {
    response = await call();
  } catch (caught) {
    throw new Error(readError(caught, fallbackMessage), { cause: caught });
  }
  if (!response.ok) {
    throw new Error(await readProblem(response as unknown as Response, fallbackMessage));
  }
  return response.json();
}

/** Extra options forwarded to {@link useApiQuery} (everything `useQuery` accepts but the key/fn). */
export type ApiQueryOptions<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

/**
 * Build a **typed query definition** — the standard way to declare a read.
 *
 * @remarks
 * Returns a TanStack `queryOptions` object whose `queryKey` carries its data type (a `DataTag`), so
 * `useApiQuery(def)`, `queryClient.prefetchQuery(def)`, and especially
 * `queryClient.setQueryData(def.queryKey, value)` / cache priming are all **type-checked against
 * `T`** — no `unknown`, no untyped keys that let cache writes drift from the read's type. The
 * RPC error handling (problem-detail → readable message via {@link unwrap}) is baked into the
 * query fn, and a {@link STALE} tier can be passed through `options`.
 *
 * @example
 * ```ts
 * const taskDef = (orgId: string, id: string) =>
 *   apiQueryOptions(
 *     queryKeys.task(orgId, id),
 *     () => api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id } }),
 *     'Could not load the task.',
 *     { staleTime: STALE.volatile },
 *   );
 *
 * const q = useApiQuery(taskDef(orgId, id));                  // q.data: TaskOut | undefined
 * queryClient.setQueryData(taskDef(orgId, id).queryKey, row); // type error unless `row` is TaskOut
 * ```
 *
 * @typeParam T - The parsed response body type, inferred from `call`.
 */
export function apiQueryOptions<T>(
  key: QueryKey,
  call: () => Promise<RpcResponse<T>>,
  fallbackMessage: string,
  options?: ApiQueryOptions<T>,
) {
  return queryOptions<T>({
    queryKey: key,
    queryFn: () => unwrap(call, fallbackMessage),
    ...options,
  });
}

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
 * Returns a prefetch function that warms a query {@link apiQueryOptions | definition} into the
 * cache — call it on a row's hover/focus (`onMouseEnter`/`onFocus`) so the subsequent navigation
 * renders from cache instead of fetching after paint. Pass the SAME definition the destination
 * reads with, so there is one source of truth. A no-op when the data is already fresh.
 *
 * @returns a `(def) => void` prefetcher bound to the active query client.
 */
export function usePrefetchApi(): (def: Parameters<QueryClient['prefetchQuery']>[0]) => void {
  const queryClient = useQueryClient();
  return (def) => {
    void queryClient.prefetchQuery(def);
  };
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
