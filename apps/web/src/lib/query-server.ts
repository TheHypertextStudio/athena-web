import type { AppType } from '@docket/api';
import { dehydrate, type QueryClient } from '@tanstack/react-query';
import { hc } from 'hono/client';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { createQueryClient } from './query-core';

/**
 * Server-side (RSC) half of the data layer — used only by Server Components to prefetch queries and
 * hand a warm cache to the client via `<HydrationBoundary>`. Importing `next/headers` makes this
 * module server-only; never import it into a client component.
 *
 * @remarks
 * The flow on an entry page is: build a request-scoped {@link getServerQueryClient}, prefetch the
 * page's queries with {@link getServerApi} (which forwards the caller's session cookie so the reads
 * are authenticated), then render `<HydrationBoundary state={dehydrate(qc)}>` around the existing
 * client page. The client's `useApiQuery` hooks read the same query keys and hydrate instantly — no
 * skeleton on first paint, and no client code change (the keys are identical). A failed server
 * prefetch degrades gracefully: nothing is cached for that key, so the client simply fetches it.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */

/**
 * A request-scoped {@link QueryClient} for Server-Component prefetch.
 *
 * @remarks
 * Wrapped in React `cache()` so every prefetch within a single request/render shares one client
 * (and therefore one dehydrated payload), while each request gets a fresh client that never leaks
 * across requests.
 *
 * @returns the request's server {@link QueryClient}.
 */
export const getServerQueryClient: () => QueryClient = cache(createQueryClient);

/**
 * Build a server-side Hono RPC client for RSC prefetch.
 *
 * @remarks
 * Mirrors the browser client's same-origin model ({@link api}): it targets the app's own origin —
 * resolved from the incoming request's forwarded host — so the Next `rewrites` proxy `/v1/*` to the
 * API exactly as in the browser, and it forwards the caller's Better Auth session cookie so the
 * server reads are authenticated as the current user. Because it is same-origin, the cookie stays
 * valid (no cross-domain mismatch).
 *
 * @returns a typed Hono client bound to the request's origin + session cookie.
 */
export async function getServerApi(): Promise<ReturnType<typeof hc<AppType>>> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host') ?? '';
  const proto = headerStore.get('x-forwarded-proto') ?? 'https';
  const origin = host ? `${proto}://${host}` : '';
  const cookie = cookieStore.toString();
  return hc<AppType>(origin, { headers: { cookie } });
}

export { dehydrate };
