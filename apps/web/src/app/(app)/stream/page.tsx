'use client';

/** Cross-org Stream — the complete timeline across the caller's workspaces. */
import { type JSX, useState } from 'react';

import { AthenaContextAction } from '@/components/athena/athena-context-action';
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
      <div className="absolute top-4 right-4 z-20">
        <AthenaContextAction
          label={selected ? 'Open Athena for this event' : 'Open Athena for Stream'}
          context={
            selected
              ? {
                  workspaceId: selected.organizationId,
                  source: { type: 'stream_event', id: selected.id, label: selected.title },
                }
              : null
          }
          variant="ghost"
        />
      </div>
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
