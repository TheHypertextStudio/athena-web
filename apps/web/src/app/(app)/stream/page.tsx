'use client';

/** Cross-org Stream — the complete timeline across the caller's workspaces. */
import type { JSX } from 'react';

import { StreamView } from '@/components/stream/stream-view';
import { useStreamPage } from '@/components/stream/use-stream-page';

/**
 * The cross-org Stream route — every event in the caller's workspace context, with each event's
 * full record expandable in place.
 *
 * @returns the personal Stream page.
 */
export default function StreamPage(): JSX.Element {
  const data = useStreamPage({ scope: 'me' });
  return <StreamView {...data} />;
}
