'use client';

/** Cross-org personal Stream — everything concerning the caller across all workspaces. */
import { type JSX, useState } from 'react';

import { EventDrawer } from '@/components/stream/event-drawer';
import type { StreamEventRow } from '@/components/stream/stream-meta';
import { StreamView } from '@/components/stream/stream-view';
import { useStreamPage } from '@/components/stream/use-stream-page';

export default function StreamPage(): JSX.Element {
  const data = useStreamPage({ scope: 'me' });
  const [selected, setSelected] = useState<StreamEventRow | null>(null);
  return (
    <>
      <StreamView {...data} actions={{}} onSelect={setSelected} />
      <EventDrawer
        row={selected}
        onClose={() => {
          setSelected(null);
        }}
        actions={{}}
      />
    </>
  );
}
