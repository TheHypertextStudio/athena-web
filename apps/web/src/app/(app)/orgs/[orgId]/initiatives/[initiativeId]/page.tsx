/**
 * An Initiative's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the bounded aggregate with the caller's session cookie and dehydrates the exact query
 * key the client detail page reads. The page therefore paints the document it fetched rather than
 * an identity-only transition shell.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { queryKeys } from '@/lib/query-keys';
import { apiQueryOptions } from '@/lib/query';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import InitiativeDetailClient from './initiative-detail-client';

/**
 * The Initiative detail page (Server Component).
 *
 * @param props - The route params (org and initiative ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function InitiativeDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; initiativeId: string }>;
}): Promise<JSX.Element> {
  const { orgId, initiativeId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient
    .prefetchQuery(
      apiQueryOptions(
        queryKeys.initiativeAggregate(orgId, initiativeId),
        () =>
          api.v1.orgs[':orgId'].initiatives[':id']['aggregate-detail'].$get({
            param: { orgId, id: initiativeId },
          }),
        'Could not refresh this initiative.',
      ),
    )
    .catch(() => undefined);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <InitiativeDetailClient />
    </HydrationBoundary>
  );
}
