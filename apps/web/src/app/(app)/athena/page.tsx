'use client';

import { useSearchParams } from 'next/navigation';
import type { JSX } from 'react';

import { AthenaWorkspace } from '@/components/athena/athena-workspace';
import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** Parse the compact `type:id` contextual handoff carried by Athena links. */
function readSource(value: string | null, label: string | null): PersonalAthenaSource | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) return undefined;
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    type !== 'task' &&
    type !== 'project' &&
    type !== 'initiative' &&
    type !== 'program' &&
    type !== 'calendar_item' &&
    type !== 'stream_event'
  ) {
    return undefined;
  }
  return { type, id, ...(label ? { label } : {}) };
}

/** The full personal, cross-workspace Athena operations route. */
export default function AthenaPage(): JSX.Element {
  const search = useSearchParams();
  const workspaceId = search.get('workspace');
  const source = readSource(search.get('context'), search.get('contextLabel'));
  const context: PersonalAthenaContext | null =
    workspaceId || source
      ? { ...(workspaceId ? { workspaceId } : {}), ...(source ? { source } : {}) }
      : null;

  return (
    <AthenaWorkspace
      initialSessionId={search.get('session')}
      workspaceFilter={workspaceId}
      invocationContext={context}
      startNewWork={search.get('new') === '1'}
    />
  );
}
