/**
 * The workspace Library — server entry.
 *
 * @remarks
 * Reads the same org-scoped search endpoint the command palette does, with no `q`, which is browse
 * mode. Prefetching it here means the roster paints from data on first load rather than from a
 * skeleton; a failed prefetch degrades to the client fetching it.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import LibraryClient from '@/components/library/library-client';
import { LIBRARY_KINDS } from '@/components/library/resource-catalog';
import { unwrap } from '@/lib/query-core';
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
}: {
  params: Promise<{ orgId: string }>;
}): Promise<JSX.Element> {
  const { orgId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();
  const kinds = LIBRARY_KINDS.join(',');

  await queryClient
    .prefetchQuery({
      queryKey: queryKeys.search('org', `library:${kinds}`, orgId),
      queryFn: () =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].search.$get({
              param: { orgId },
              query: { kinds, limit: '100' },
            }),
          'Could not load the library.',
        ),
    })
    .catch(() => undefined);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LibraryClient orgId={orgId} />
    </HydrationBoundary>
  );
}
