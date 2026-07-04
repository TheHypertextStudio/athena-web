/**
 * Server-safe core of the dynamic-data layer — no React, no `'use client'`.
 *
 * @remarks
 * Holds the parts of the data layer that are pure (no hooks): the {@link QueryClient} factory, the
 * Hono-RPC→TanStack bridge ({@link unwrap}), the staleness tiers ({@link STALE}), and the typed
 * query-definition builder ({@link apiQueryOptions}). Splitting these out of `query.ts` (which is
 * `'use client'`) lets React Server Components build/prefetch the very same query definitions and a
 * request-scoped client for SSR hydration, without importing the client-only hooks. The public
 * surface and every client hook re-export from here via `query.ts`, so consumers still import
 * everything from `@/lib/query`.
 *
 * @see `docs/engineering/specs/data-layer.md` for the full standard.
 */
import type { Problem } from '@docket/types';
import {
  infiniteQueryOptions,
  MutationCache,
  QueryCache,
  QueryClient,
  type QueryKey,
  queryOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { readError, readProblemDetails } from '@/lib/problem';

/**
 * Thrown by {@link unwrap} when the API rejects a request with `401 Unauthorized` — i.e. the session
 * expired or was revoked mid-use.
 *
 * @remarks
 * A distinct type (not a bare `Error`) so a global handler can tell "your session ended, sign in
 * again" apart from ordinary request failures and drive the sign-out + redirect exactly once,
 * rather than surfacing a generic inline "could not load" on whatever surface made the call.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Staleness tiers (ms). Every query picks one based on how fast its data changes, rather than a
 * single flat default: `standard` is the {@link createQueryClient} default; pass
 * `{ staleTime: STALE.volatile }` to a read for fast-moving data (task state, in-flight sessions,
 * counts) and `STALE.static` for data that rarely changes within a session (members, teams,
 * vocabulary, roles). See `docs/engineering/specs/data-layer.md`.
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
 * Build a {@link QueryClient} with the app-wide defaults.
 *
 * @remarks
 * On the client this is called once via a `useState` lazy initializer in `providers.tsx` so a
 * single, stable client survives re-renders without leaking across requests. On the server a fresh
 * one is created per request for SSR prefetch (see `getServerQueryClient` in `query-server.ts`).
 * The defaults make every surface dynamic by default: a 30s `staleTime` avoids refetch storms while
 * keeping data live, `refetchOnWindowFocus` pulls fresh data when the user returns to the tab
 * (replacing manual "Refresh" buttons), and a single `retry` smooths a transient network blip.
 *
 * An optional `onError` (injected by the client providers) is invoked for every failed query AND
 * mutation, so a {@link SessionExpiredError} from any read/write drives a single global sign-out +
 * redirect. It is intentionally a parameter (not baked in) so the server-safe core stays free of
 * browser/router coupling — the SSR client passes nothing.
 *
 * @param handlers - Optional global cache handlers (`onError`), wired by the client providers.
 * @returns a configured {@link QueryClient}.
 */
export function createQueryClient(handlers?: { onError?: (error: unknown) => void }): QueryClient {
  const onError = handlers?.onError;
  return new QueryClient({
    ...(onError
      ? {
          queryCache: new QueryCache({ onError }),
          mutationCache: new MutationCache({ onError }),
        }
      : {}),
    defaultOptions: {
      queries: {
        staleTime: STALE.standard,
        gcTime: DEFAULT_GC_TIME_MS,
        refetchOnWindowFocus: true,
        // A 401 (session expired) is not worth retrying — fail fast so the global handler redirects.
        retry: (failureCount, error) => !(error instanceof SessionExpiredError) && failureCount < 1,
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
 * The error {@link unwrap} throws for a non-OK API response.
 *
 * @remarks
 * An `Error` subclass (so it satisfies TanStack's `DefaultError` and every existing
 * `error.message` read keeps working unchanged) that additionally carries the HTTP `status` and,
 * when the body parsed as a {@link Problem}, its machine-readable `code`. A caller can
 * `instanceof`-narrow to this type to distinguish ONE specific failure (e.g. the Linear
 * write-scope 409 on `PATCH /integrations/:id`) from any other failure on the same endpoint (e.g.
 * a 422 from an unrelated validation error) — the message string alone can't do that, since two
 * different failures can produce unrelated messages that both need distinct handling, or (less
 * commonly) similar-looking ones that don't.
 *
 * @see `IntegrationConfigPanel`'s two-way re-auth notice for the motivating use.
 */
export class ApiRequestError extends Error {
  /** The response's HTTP status code. */
  readonly status: number;
  /** The closed problem code, when the body parsed as a {@link Problem}. */
  readonly code?: Problem['code'];

  constructor(details: { message: string; status: number; code?: Problem['code'] }) {
    super(details.message);
    this.name = 'ApiRequestError';
    this.status = details.status;
    this.code = details.code;
  }
}

/**
 * Await a Hono RPC call and return its parsed body, throwing a readable error on failure.
 *
 * @remarks
 * The bridge between the Hono RPC convention (a `Response` whose `.ok` is checked, with errors
 * emitted as `application/problem+json`) and TanStack Query's throw-to-signal-error convention.
 * On a non-OK response it throws an {@link ApiRequestError} whose message is the server's problem
 * `detail`/`title` (via {@link readProblemDetails}) and whose `status`/`code` a caller may narrow
 * on; the thrown value flows into the hook's `error` state. A rejection from the call itself
 * (network failure) is re-thrown as a plain `Error` with a readable message via {@link readError}
 * — there is no HTTP response to carry a `status`/`code` in that case.
 *
 * @typeParam T - The parsed response body type, inferred from the Hono client call.
 * @param call - A thunk performing exactly one Hono RPC call.
 * @param fallbackMessage - The message to surface when the server sends no problem detail.
 * @returns the parsed response body.
 * @throws {ApiRequestError} when the response is non-OK.
 * @throws {Error} when the request itself rejects (network failure).
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
    if (response.status === 401) throw new SessionExpiredError();
    const details = await readProblemDetails(response as unknown as Response, fallbackMessage);
    throw new ApiRequestError(details);
  }
  return response.json();
}

/** Extra options forwarded to a read (everything `useQuery` accepts but the key/fn). */
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
 * query fn, and a {@link STALE} tier can be passed through `options`. Pure (no React), so a Server
 * Component can build the same definition to prefetch into a request-scoped client for hydration.
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

/** Tunables forwarded to an infinite read (staleness + polling for the live seam). */
export interface ApiInfiniteOptions {
  /** Override the {@link STALE} tier. */
  readonly staleTime?: number;
  /** Focus-gated poll interval (ms); set by the live variant for the stream seam. */
  readonly refetchInterval?: number;
}

/**
 * Build a **typed cursor-paginated query definition** — the standard way to declare an
 * infinite read (the Stream firehose).
 *
 * @remarks
 * Wraps TanStack `infiniteQueryOptions`: the fetcher takes the opaque `cursor` page-param and
 * returns one page; `getNextPageParam` reads the page's `nextCursor` (absent → end). The same
 * RPC error handling as {@link apiQueryOptions} is baked in via {@link unwrap}. The page param
 * is `string | undefined` (the first page passes `undefined`).
 *
 * @typeParam TPage - The page response shape (e.g. `StreamPageOut`).
 * @param key - The query key (carries the serialized filter params so each variant caches apart).
 * @param call - Performs one page fetch for the given cursor.
 * @param getNextPageParam - Returns the next cursor from a page, or `undefined` when exhausted.
 * @param fallbackMessage - Surfaced when the server sends no problem detail.
 * @param options - Optional staleness / poll interval.
 */
export function apiInfiniteQueryOptions<TPage>(
  key: QueryKey,
  call: (cursor: string | undefined) => Promise<RpcResponse<TPage>>,
  getNextPageParam: (lastPage: TPage) => string | undefined,
  fallbackMessage: string,
  options?: ApiInfiniteOptions,
) {
  return infiniteQueryOptions({
    queryKey: key,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      unwrap(() => call(pageParam), fallbackMessage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam,
    ...options,
  });
}

/** The typed definition returned by {@link apiInfiniteQueryOptions} for a page shape `TPage`. */
export type ApiInfiniteDef<TPage> = ReturnType<typeof apiInfiniteQueryOptions<TPage>>;
