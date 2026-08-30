'use client';

/** Per-workspace Stream — the firehose of every event in this org. */
import { useTypedRoute } from '@/lib/app-location';
import type { JSX } from 'react';

import { StreamView } from '@/components/stream/stream-view';
import { useStreamPage } from '@/components/stream/use-stream-page';

/**
 * The per-workspace Stream route — the firehose of every event in this org, filterable, with
 * click-to-expand event detail inline in the feed.
 *
 * @returns the workspace Stream page.
 */
export default function WorkspaceStreamPage(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/stream');
  const data = useStreamPage({ scope: 'org', orgId });
  return <StreamView {...data} />;
}
