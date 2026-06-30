'use client';

/** Per-workspace Stream — the firehose of every event in this org. */
import { useParams } from 'next/navigation';
import { type JSX, useState } from 'react';

import { EventDrawer } from '@/components/stream/event-drawer';
import type { StreamEventRow } from '@/components/stream/stream-meta';
import { StreamView } from '@/components/stream/stream-view';
import { useStreamPage } from '@/components/stream/use-stream-page';

export default function WorkspaceStreamPage(): JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const data = useStreamPage({ scope: 'org', orgId });
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
