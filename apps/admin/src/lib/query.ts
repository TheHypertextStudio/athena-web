'use client';

/**
 * The admin console's dynamic-data layer — a thin, fully-typed wrapper over TanStack Query v5 and
 * the Hono RPC clients in `lib/api.ts`.
 *
 * @remarks
 * Every screen used to hand-roll `useEffect` + `useState` + a manual `load()`, which the repo's
 * agent guidelines forbid and which produced three visible defects: typing in a search box blanked
 * the whole list to skeletons on every debounce, navigating back re-fetched from zero, and nothing
 * ever refreshed on its own. This module is the single contract those screens migrate onto.
 *
 * - {@link apiQueryOptions} builds a **typed query definition** (key + fetcher + optional
 *   {@link STALE} tier) whose key carries its data type, so reads and cache writes are checked
 *   against the response shape.
 * - {@link useApiQuery} is the read hook. {@link useApiListQuery} adds `placeholderData:
 *   keepPreviousData` so a list **dims** while refetching rather than collapsing to skeletons —
 *   the fix for the search-debounce flash. {@link useLiveApiQuery} adds a focus-only poll for the
 *   queue counts in the sidebar.
 * - {@link useApiMutation} is the write hook: it invalidates a set of related keys on settle so
 *   dependent surfaces refresh without a manual button.
 *
 * This is deliberately a *local* mirror of the product app's `apps/web/src/lib/query.ts` rather
 * than a shared package. The two clients are typed against different Hono contracts
 * (`AdminAppType` vs `AppType`), and the product layer carries offline-outbox and
 * authentication-interlock behaviour that the operator console has no use for. What is shared is
 * the shape, so the two read the same way.
 *
 * @see `docs/engineering/specs/data-layer.md` for the product-side standard this mirrors.
 */
import {
  type DefaultError,
  keepPreviousData,
  MutationCache,
  QueryCache,
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

import { readProblemError, UserFacingError } from '@/lib/problem';

/**
 * Staleness tiers (ms). Each read picks the tier matching how fast its data actually moves,
 * rather than every screen sharing one flat default.
 */
export const STALE = {
  /** Fast-moving: queue depths, in-flight reconciliation, pending counts. */
  volatile: 5_000,
  /** The default for most lists and detail reads. */
  standard: 30_000,
  /** Rarely changes within a session: the operator's own staff tier, service controls. */
  static: 300_000,
} as const;

/** How long an unused response stays in memory before TanStack Query collects it. */
const DEFAULT_GC_TIME_MS = 5 * 60_000;

/**
 * A failed admin API call, carrying application-owned copy plus the structured status.
 *
 * @remarks
 * Screens branch on {@link ApiRequestError.status} (notably 401/403 for a non-staff session) and
 * render {@link UserFacingError.message}, which is always caller-supplied copy — never the
 * provider's or the exception's own text.
 */
export class ApiRequestError extends UserFacingError {
  constructor(details: {
    message: string;
    status: number;
    code?: UserFacingError['code'];
    cause?: unknown;
  }) {
    super(details.message, {
      status: details.status,
      ...(details.code ? { code: details.code } : {}),
      ...(details.cause ? { cause: details.cause } : {}),
    });
    this.name = 'ApiRequestError';
  }
}

/** Whether a thrown error is an admin API failure carrying a 401 or 403. */
export function isAuthFailure(error: unknown): boolean {
  return error instanceof UserFacingError && (error.status === 401 || error.status === 403);
}

/**
 * The minimal structural shape this layer needs from a Hono RPC response.
 *
 * @remarks
 * Constraining to this rather than Hono's deep `ClientResponse` generic keeps the hooks ergonomic
 * and lets tests pass a lightweight mock, while `T` is still inferred end-to-end from the real
 * call — so there is no loss of type safety and no `as any`.
 */
export interface RpcResponse<T> {
  readonly ok: boolean;
  readonly status: number;
  json: () => Promise<T>;
}

/** The parsed body of an RPC response, without flattening a discriminated response union. */
type RpcResponseBody<TResponse> = TResponse extends RpcResponse<infer T> ? T : never;

/**
 * Perform one RPC call and resolve its parsed body, converting any failure into an
 * {@link ApiRequestError} carrying application-owned copy.
 *
 * @param call - A thunk performing exactly one Hono RPC call.
 * @param fallbackMessage - Application-owned copy for this operation.
 * @returns the parsed response body.
 * @throws {ApiRequestError} when the request rejects or the response is non-OK.
 */
export function unwrap<TResponse extends RpcResponse<unknown>>(
  call: () => Promise<TResponse>,
  fallbackMessage: string,
): Promise<RpcResponseBody<TResponse>>;
/** Keep the runtime implementation erased while the public overload preserves each RPC body. */
export async function unwrap(
  call: () => Promise<RpcResponse<unknown>>,
  fallbackMessage: string,
): Promise<unknown> {
  let response: RpcResponse<unknown>;
  try {
    response = await call();
  } catch (caught) {
    // Status 0 marks "the request never reached the server" — a network failure, not an answer.
    throw new ApiRequestError({ message: fallbackMessage, status: 0, cause: caught });
  }
  if (!response.ok) {
    const problem = await readProblemError(response as unknown as Response, fallbackMessage);
    throw new ApiRequestError({
      message: problem.message,
      status: response.status,
      ...(problem.code ? { code: problem.code } : {}),
    });
  }
  return response.json();
}

/** Extra options forwarded to a read — everything `useQuery` accepts but the key and fetcher. */
export type ApiQueryOptions<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

/**
 * Build a **typed query definition** — the standard way to declare a read in this console.
 *
 * @remarks
 * Returns a TanStack `queryOptions` object whose `queryKey` carries its data type, so
 * `useApiQuery(def)` and `queryClient.setQueryData(def.queryKey, value)` are both checked against
 * `T`. Pure (no React), so a definition can be built anywhere and prefetched.
 *
 * @typeParam T - The parsed response body type, inferred from `call`.
 * @param key - The cache key, from `queryKeys`.
 * @param call - A thunk performing exactly one Hono RPC call.
 * @param fallbackMessage - Application-owned copy shown when the call fails.
 * @param options - Optional TanStack overrides, typically a {@link STALE} tier.
 * @returns a typed query definition.
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
 * Read hook: subscribe a component to a typed query definition.
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @returns the query result for the parsed body.
 */
export function useApiQuery<T>(def: UseQueryOptions<T>): UseQueryResult<T> {
  return useQuery(def);
}

/**
 * Read hook for lists: like {@link useApiQuery}, but the previous page stays on screen while the
 * next one loads.
 *
 * @remarks
 * This is the fix for the search-box flash. Without `keepPreviousData` every debounced keystroke
 * moved the query to a new key with no data, so the whole list unmounted into skeletons and back
 * — a flicker on every character. With it the rendered rows persist and `isFetching` is true, so a
 * caller can dim the list instead of destroying it.
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @returns the query result, holding the previous page while a new key resolves.
 */
export function useApiListQuery<T>(def: UseQueryOptions<T>): UseQueryResult<T> {
  return useQuery({ ...def, placeholderData: keepPreviousData });
}

/**
 * Read hook for data that must stay current without anyone pressing anything.
 *
 * @remarks
 * Polls only while the document has focus, so a console left open in a background tab stops
 * talking to the API. Used for the sidebar's queue counts.
 *
 * @typeParam T - The parsed response body type, carried by the definition.
 * @param def - A typed definition from {@link apiQueryOptions}.
 * @param intervalMs - The polling interval while focused.
 * @returns the query result, refreshed on the given interval.
 */
export function useLiveApiQuery<T>(def: UseQueryOptions<T>, intervalMs: number): UseQueryResult<T> {
  return useQuery({
    ...def,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
  });
}

/**
 * Options for {@link useApiMutation}, plus the keys to invalidate once it settles.
 *
 * @typeParam TOnMutateResult - Whatever an `onMutate` callback returns, handed back to the later
 * callbacks so an optimistic update can roll itself back.
 */
export interface ApiMutationOptions<TData, TVariables, TOnMutateResult> extends Omit<
  UseMutationOptions<TData, DefaultError, TVariables, TOnMutateResult>,
  'mutationFn'
> {
  /**
   * Query keys to invalidate after the mutation settles, success or failure.
   *
   * @remarks
   * Invalidating on failure too is deliberate: a write that failed part-way can still have moved
   * server state, and re-reading is the only way to know what is actually there.
   */
  readonly invalidates?: readonly QueryKey[] | undefined;
}

/**
 * Write hook: run one RPC call and refresh whatever it affected.
 *
 * @typeParam TData - The parsed response body of the mutation.
 * @typeParam TVariables - The mutation's input.
 * @typeParam TOnMutateResult - The value an `onMutate` callback passes forward.
 * @param call - Performs the RPC call for a given input.
 * @param fallbackMessage - Application-owned copy shown when the call fails.
 * @param options - Optional TanStack overrides plus {@link ApiMutationOptions.invalidates}.
 * @returns the mutation result.
 */
export function useApiMutation<TData, TVariables, TOnMutateResult = unknown>(
  call: (variables: TVariables) => Promise<RpcResponse<TData>>,
  fallbackMessage: string,
  options?: ApiMutationOptions<TData, TVariables, TOnMutateResult>,
): UseMutationResult<TData, DefaultError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  const { invalidates, onSettled, ...rest } = options ?? {};
  return useMutation<TData, DefaultError, TVariables, TOnMutateResult>({
    ...rest,
    mutationFn: (variables: TVariables) => unwrap(() => call(variables), fallbackMessage),
    onSettled: (data, error, variables, onMutateResult, context) => {
      for (const key of invalidates ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onSettled?.(data, error, variables, onMutateResult, context);
    },
  });
}

/**
 * Build the console's {@link QueryClient} with its app-wide defaults.
 *
 * @remarks
 * Called once from a lazy `useState` initializer in `providers.tsx`, so one stable client survives
 * re-renders. The defaults make every screen dynamic by default: a 30s `staleTime` avoids refetch
 * storms while keeping data live, and `refetchOnWindowFocus` pulls fresh data when the operator
 * returns to the tab — which is what replaces the manual refresh buttons.
 *
 * A 401/403 is never retried. For an operator whose session is not staff, retrying just delays the
 * inline error and the sign-in affordance beside it.
 *
 * @param handlers - Optional global cache handlers, wired by the client providers.
 * @returns a configured client.
 */
export function createQueryClient(handlers?: {
  onError?: ((error: unknown) => void) | undefined;
}): QueryClient {
  const onError = handlers?.onError;
  return new QueryClient({
    ...(onError
      ? { queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }) }
      : {}),
    defaultOptions: {
      queries: {
        staleTime: STALE.standard,
        gcTime: DEFAULT_GC_TIME_MS,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !isAuthFailure(error) && failureCount < 1,
      },
    },
  });
}

export { queryKeys } from './query-keys';
