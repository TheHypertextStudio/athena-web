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
  QueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { readError, readProblem } from '@/lib/problem';

/** The app-wide stale time: data is considered fresh for 30s before a background refetch. */
const DEFAULT_STALE_TIME_MS = 30_000;

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
        staleTime: DEFAULT_STALE_TIME_MS,
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

/**
 * The org-scoped, hierarchical query-key convention.
 *
 * @remarks
 * Every key is a tuple beginning with the org id (or `'me'` for the cross-org account scope),
 * then the entity collection, then — for detail keys — the entity id. Because TanStack matches
 * keys by prefix, invalidating a coarse key (e.g. `queryKeys.projects(orgId)`) also invalidates
 * every finer key under it (each `queryKeys.project(orgId, id)`), which is exactly what a list
 * mutation wants. Keys are returned `as const` so they are stable, structurally-typed tuples.
 *
 * @example
 * ```ts
 * useApiQuery(queryKeys.projects(orgId), () =>
 *   api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
 * );
 * ```
 */
export const queryKeys = {
  /** The org's project roster. */
  projects: (orgId: string) => ['org', orgId, 'projects'] as const,
  /** One project's detail. */
  project: (orgId: string, projectId: string) => ['org', orgId, 'projects', projectId] as const,
  /** The org's task list. */
  tasks: (orgId: string) => ['org', orgId, 'tasks'] as const,
  /** One task's detail. */
  task: (orgId: string, taskId: string) => ['org', orgId, 'tasks', taskId] as const,
  /** The org's program roster. */
  programs: (orgId: string) => ['org', orgId, 'programs'] as const,
  /** One program's detail. */
  program: (orgId: string, programId: string) => ['org', orgId, 'programs', programId] as const,
  /** The org's initiative roster. */
  initiatives: (orgId: string) => ['org', orgId, 'initiatives'] as const,
  /** One initiative's detail. */
  initiative: (orgId: string, initiativeId: string) =>
    ['org', orgId, 'initiatives', initiativeId] as const,
  /** The org's cycle roster. */
  cycles: (orgId: string) => ['org', orgId, 'cycles'] as const,
  /** One cycle's detail. */
  cycle: (orgId: string, cycleId: string) => ['org', orgId, 'cycles', cycleId] as const,
  /** The org's team roster. */
  teams: (orgId: string) => ['org', orgId, 'teams'] as const,
  /** One team's detail. */
  team: (orgId: string, teamId: string) => ['org', orgId, 'teams', teamId] as const,
  /** The org's member roster. */
  members: (orgId: string) => ['org', orgId, 'members'] as const,
  /** The org's role roster. */
  roles: (orgId: string) => ['org', orgId, 'roles'] as const,
  /** The org's pending invitations. */
  invitations: (orgId: string) => ['org', orgId, 'invitations'] as const,
  /** The org's connected integrations. */
  integrations: (orgId: string) => ['org', orgId, 'integrations'] as const,
  /** The org's available integration provider directory. */
  integrationsDirectory: (orgId: string) => ['org', orgId, 'integrations-directory'] as const,
  /** The org's saved view definitions. */
  savedViews: (orgId: string) => ['org', orgId, 'saved-views'] as const,
  /** The org's agent roster. */
  agents: (orgId: string) => ['org', orgId, 'agents'] as const,
  /** The org's view definitions. */
  views: (orgId: string) => ['org', orgId, 'views'] as const,
  /** The org's settings payload (a settings tab's backing data). */
  settings: (orgId: string, tab: string) => ['org', orgId, 'settings', tab] as const,
  /** The signed-in account's org list (cross-org account scope). */
  orgs: () => ['me', 'orgs'] as const,
  /** The signed-in account's cross-org portfolio timeline (cross-org account scope). */
  portfolio: () => ['me', 'portfolio'] as const,
  /** The signed-in account's cross-org entity search for a query (cross-org account scope). */
  hubSearch: (query: string) => ['me', 'search', query] as const,
} as const;

/** Extra options forwarded to {@link useApiQuery} (everything `useQuery` accepts but the key/fn). */
export type ApiQueryOptions<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

/**
 * Read hook: subscribe a component to one Hono RPC GET, with the app's live-data defaults.
 *
 * @remarks
 * Replaces the hand-rolled `useEffect` + `useState` + `load()` pattern. The `queryFn` runs the
 * supplied Hono call through {@link unwrap}, so the hook's `data` is the parsed body and its
 * `error` carries the server's problem message on failure. It inherits the {@link createQueryClient}
 * defaults (30s stale time, refetch-on-focus, one retry), so the surface stays fresh without a
 * manual refresh button. Pass `enabled: false` (via `options`) to gate a query on a prerequisite.
 *
 * @typeParam T - The parsed response body type, inferred from `call`.
 * @param key - The query key from {@link queryKeys}.
 * @param call - A thunk performing the Hono RPC GET.
 * @param fallbackMessage - The message to surface when the server sends no problem detail.
 * @param options - Extra `useQuery` options (e.g. `enabled`, `select`).
 * @returns the {@link UseQueryResult} for the parsed body.
 */
export function useApiQuery<T>(
  key: QueryKey,
  call: () => Promise<RpcResponse<T>>,
  fallbackMessage: string,
  options?: ApiQueryOptions<T>,
): UseQueryResult<T> {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => unwrap(call, fallbackMessage),
    ...options,
  });
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
 * @typeParam T - The parsed response body type, inferred from `call`.
 * @param key - The query key from {@link queryKeys}.
 * @param call - A thunk performing the Hono RPC GET.
 * @param fallbackMessage - The message to surface when the server sends no problem detail.
 * @param intervalMs - The polling interval in milliseconds.
 * @param options - Extra `useQuery` options (e.g. `enabled`).
 * @returns the {@link UseQueryResult} for the parsed body.
 */
export function useLiveApiQuery<T>(
  key: QueryKey,
  call: () => Promise<RpcResponse<T>>,
  fallbackMessage: string,
  intervalMs: number,
  options?: ApiQueryOptions<T>,
): UseQueryResult<T> {
  return useApiQuery(key, call, fallbackMessage, {
    refetchInterval: intervalMs,
    ...options,
  });
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
