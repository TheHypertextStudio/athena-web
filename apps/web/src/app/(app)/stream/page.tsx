'use client';

/** Cross-org Stream — the complete timeline across the caller's workspaces. */
import { type JSX, useState } from 'react';

import { EventDrawer } from '@/components/stream/event-drawer';
import type { StreamEventRow } from '@/components/stream/stream-meta';
import { StreamView } from '@/components/stream/stream-view';
import { useStreamPage } from '@/components/stream/use-stream-page';

/**
 * The cross-org Stream route — every event in the caller's workspace context, with exact-event
 * inspection in a drawer.
 *
 * @returns the personal Stream page.
 */
export default function StreamPage(): JSX.Element {
  const data = useStreamPage({ scope: 'me' });
  const [selected, setSelected] = useState<StreamEventRow | null>(null);
  return (
    <div className="relative h-full min-h-0">
      <StreamView {...data} onSelect={setSelected} />
      <EventDrawer
        row={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </div>
  );
}
