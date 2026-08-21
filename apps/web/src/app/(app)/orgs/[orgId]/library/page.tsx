/**
 * The workspace Library — server entry.
 *
 * @remarks
 * Reads the same org-scoped search endpoint as the client. Prefetching the first browse or search
 * page means the roster paints from data on first load instead of a skeleton. A failed prefetch
 * degrades to the client fetching it.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { SearchOut } from '@docket/types';
import type { JSX } from 'react';

import LibraryClient from '@/components/library/library-client';
import { buildLibrarySearchQuery, libraryQueryKeyPart } from '@/components/library/library-data';
import { apiInfiniteQueryOptions } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

/**
 * The Library page (Server Component).
 *
 * @param props - The route params (the active org id, async in Next 16).
 * @returns the hydrated resource roster.
 */
export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryParam = (await searchParams)['q'];
  const query = (Array.isArray(queryParam) ? queryParam[0] : queryParam)?.trim() ?? '';
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient
    .prefetchInfiniteQuery(
      apiInfiniteQueryOptions<SearchOut>(
        queryKeys.search('org', libraryQueryKeyPart(query), orgId),
        (cursor, signal) =>
          api.v1.orgs[':orgId'].search.$get(
            {
              param: { orgId },
              query: buildLibrarySearchQuery(query, cursor),
            },
            { init: { signal } },
          ),
        (lastPage) => lastPage.nextCursor,
        query ? 'Could not search the library.' : 'Could not load the library.',
      ),
    )
    .catch(() => undefined);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LibraryClient orgId={orgId} />
    </HydrationBoundary>
  );
}
