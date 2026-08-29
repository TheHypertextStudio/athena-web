/**
 * A Task's detail — server entry (SSR prefetch + hydration).
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

import { apiQueryOptions } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { apiQueryOptions } from '@/lib/query-core';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import TaskDetailClient from './task-detail-client';

/**
 * The Task detail page (Server Component).
 *
 * @param props - The route params (org and task ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; taskId: string }>;
}): Promise<JSX.Element> {
  const { orgId, taskId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient
    .prefetchQuery(
      apiQueryOptions(
        queryKeys.taskAggregate(orgId, taskId),
        () =>
          api.v1.orgs[':orgId'].tasks[':id']['aggregate-detail'].$get({
            param: { orgId, id: taskId },
          }),
        'Could not refresh this task.',
      ),
    )
    .catch(() => undefined);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskDetailClient />
    </HydrationBoundary>
  );
}
