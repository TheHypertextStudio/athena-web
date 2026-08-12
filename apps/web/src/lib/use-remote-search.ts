'use client';

/**
 * `useRemoteSearch` — search-as-you-type against the server, without re-deriving the mechanism.
 *
 * @remarks
 * Every search-as-you-type surface in this app performs the same five moves: trim the input,
 * debounce it, put the *settled* term into the query key, gate the request, and report "pending"
 * for both the mid-burst window and the in-flight request. That sequence had been written by hand
 * five times — the command palette, the two mention waves, the search page, and the Notion page
 * picker — and the pending expression appeared verbatim in three of them. Two of the five did not
 * even use {@link useDebouncedValue}, despite its own docstring saying it was extracted from one
 * of them.
 *
 * ## Debounce the term, not the request
 *
 * The settled term goes into the query key, so TanStack owns deduplication, cancellation and
 * race-safety. Debouncing the *fetch* instead leaves all three to be re-solved by hand, which is
 * exactly what the copies that drifted got wrong.
 *
 * ## Four things the shape had to accommodate
 *
 * Each was learned from a call site that would otherwise have had to keep its own copy:
 *
 * - **Two waves over one term.** The mention picker searches locally at 90ms and across connected
 *   providers at 280ms off the same keystrokes, then merges. So this hook covers *one* wave and
 *   composition stays with the caller — call it twice.
 * - **`enabled` is not derived from the term.** The command palette treats an empty query as a
 *   legitimate "browse my recents" request. A hook that quietly gated on `term.length > 0` would
 *   have silently broken it, which is why {@link RemoteSearchInput.minChars} defaults to 0 and is
 *   opt-in.
 * - **Two error idioms.** The mention menu branches on a boolean and renders its own copy; the
 *   others render a string. Both are returned, because forcing one would have produced a second
 *   variant of this hook within a release.
 * - **The caller builds the key.** `mentionLocal`, `mentionExternal`, `search` and
 *   `notionParentPages` differ in prefix and arity; only the convention that the term comes last
 *   is shared.
 *
 * @see {@link useDebouncedValue} for the settle step this composes.
 */
import type { QueryKey } from '@tanstack/react-query';

import { userErrorMessage } from './problem';
import { type ApiQueryOptions, type RpcResponse, apiQueryOptions, useApiListQuery } from './query';
import { useDebouncedValue } from './use-debounced-value';

/** Inputs for {@link useRemoteSearch}. */
export interface RemoteSearchInput<T> {
  /** The raw, per-keystroke text. Trimmed here, so callers need not. */
  query: string;
  /**
   * Quiet period before the term reaches the server.
   *
   * @remarks
   * Deliberately has no default. Every existing call site picked its value for a measured reason —
   * 90ms against an indexed local table, 180ms for a cross-org fan-out, 280ms for a round trip to
   * somebody else's server — and a default would invite copying the wrong one.
   */
  debounceMs: number;
  /**
   * Shortest term worth searching for. Default `0` — no minimum.
   *
   * @remarks
   * Below this the request is not issued and {@link RemoteSearchState.pending} is false, so a
   * surface reserving skeleton rows does not reserve them for a search that will never run.
   */
  minChars?: number;
  /** Gate the request entirely (a closed popover, a missing id). Default `true`. */
  enabled?: boolean;
  /** Build the query key from the settled term. */
  key: (term: string) => QueryKey;
  /** Issue the request for the settled term. */
  fetch: (term: string) => Promise<RpcResponse<T>>;
  /** Application-owned copy for a failure whose cause has no better message. */
  fallbackMessage: string;
  /** Extra query options — `staleTime`, `gcTime`, and so on. */
  options?: ApiQueryOptions<T>;
}

/** What a search-as-you-type surface needs to render. */
export interface RemoteSearchState<T> {
  /** The current result wave. Holds the previous term's results rather than blanking. */
  data: T | undefined;
  /** The settled term the results belong to, for surfaces that echo it back. */
  term: string;
  /**
   * True while results for the *current* text are still expected.
   *
   * @remarks
   * Three windows, and every hand-rolled copy this hook replaced got the third wrong. The term is
   * typed but not settled; the first request is in flight; or a *new* term's request is in flight
   * while the previous term's rows are still on screen. That last one reads as `isPending: false`
   * — `keepPreviousData` means data exists, so the query is not "pending" in TanStack's sense —
   * which is precisely when a surface would drop its skeleton and present stale rows as the
   * answer. `isPlaceholderData` is the signal that closes it.
   */
  pending: boolean;
  /** True when the request failed — for surfaces that render their own copy. */
  failed: boolean;
  /** The failure as application-owned copy, or null. Never a provider's own message. */
  error: string | null;
}

/**
 * Search the server as somebody types, once per burst.
 *
 * @typeParam T - The response body.
 * @param input - The {@link RemoteSearchInput}.
 * @returns the current {@link RemoteSearchState}.
 *
 * @example
 * ```tsx
 * const search = useRemoteSearch({
 *   query: typed,
 *   debounceMs: 280,
 *   enabled: open,
 *   key: (term) => queryKeys.notionParentPages(orgId, integrationId, term),
 *   fetch: (term) => api.v1.orgs[':orgId'].pages.$get({ param: { orgId }, query: { q: term } }),
 *   fallbackMessage: 'Could not load your pages.',
 * });
 * ```
 */
export function useRemoteSearch<T>({
  query,
  debounceMs,
  minChars = 0,
  enabled = true,
  key,
  fetch,
  fallbackMessage,
  options,
}: RemoteSearchInput<T>): RemoteSearchState<T> {
  const trimmed = query.trim();
  const term = useDebouncedValue(trimmed, debounceMs);
  // Gate on the *settled* term: gating on the raw one would start a request mid-burst for a term
  // that is about to change, which is the cost the debounce exists to avoid.
  const active = enabled && term.length >= minChars;

  const searchQ = useApiListQuery<T>(
    apiQueryOptions<T>(key(term), () => fetch(term), fallbackMessage, {
      ...options,
      enabled: active,
    }),
  );

  return {
    data: searchQ.data,
    term,
    // `active` multiplies the whole thing: a term below `minChars` is not pending, it is simply
    // not being searched for. `isPlaceholderData` is what catches a new term's request landing
    // while the previous term's rows are still displayed — see `RemoteSearchState.pending`.
    pending: active && (trimmed !== term || searchQ.isPending || searchQ.isPlaceholderData),
    failed: searchQ.isError,
    error: searchQ.isError ? userErrorMessage(searchQ.error, fallbackMessage) : null,
  };
}
