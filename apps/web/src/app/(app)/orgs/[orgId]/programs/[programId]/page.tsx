/**
 * A Program's detail — server entry (SSR prefetch + hydration).
 *
 * @remarks
 * Prefetches the program's own row with the caller's session cookie, dehydrates it, and hands the
 * warm cache to the client page, so the masthead — icon, name, summary, property row — is in the
 * first paint instead of behind a full composite read.
 *
 * Deliberately only the row: the page's composite read is several requests, each a hop from this
 * server back through the app's own origin to the API, so prefetching it here would move that
 * cost in front of the first byte rather than removing it. The tab panels keep loading on the
 * client, in parallel with the page becoming interactive. A failed prefetch degrades to the
 * previous behavior — nothing cached, so the client fetches it.
 *
 * @see `docs/engineering/specs/data-layer.md` §7.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import type { JSX } from 'react';

import { unwrap } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';
import { dehydrate, getServerApi, getServerQueryClient } from '@/lib/query-server';

import ProgramDetailClient from './program-detail-client';

/**
 * The Program detail page (Server Component).
 *
 * @param props - The route params (org and program ids, async in Next 16).
 * @returns The hydrated detail page.
 */
export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ orgId: string; programId: string }>;
}): Promise<JSX.Element> {
  const { orgId, programId } = await params;
  const queryClient = getServerQueryClient();
  const api = await getServerApi();

  await queryClient
    .prefetchQuery({
      queryKey: queryKeys.programRecord(orgId, programId),
      queryFn: () =>
        unwrap(
          () => api.v1.orgs[':orgId'].programs[':id'].$get({ param: { orgId, id: programId } }),
          'Could not load this program.',
        ),
    })
    .catch(() => undefined);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProgramDetailClient />
    </HydrationBoundary>
  );
}
