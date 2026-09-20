import type { WorkViewActor } from '@docket/work/work-view-contract';
import type { JSX } from 'react';
import type { ViewTarget } from '@docket/work/view-contract';
import { renderSourcePeople } from '@/components/people/source-person-references';
import type { WorkViewRowFor } from './renderer-types';

/** Display source identities only for fields whose native person reference is absent. */
export function renderWorkRowSources(
  row: WorkViewRowFor<ViewTarget>,
  field: string,
): JSX.Element | null {
  if (row.target === 'task' && field === 'assignee') return renderSourcePeople(row, field);
  if (row.target === 'project' && field === 'lead') return renderSourcePeople(row, field);
  return null;
}

/** Resolve a projected actor relation without weakening the row type. */
export function rowActor(row: WorkViewRowFor<ViewTarget>, field: string): WorkViewActor | null {
  if (row.target === 'task' && field === 'assignee') return row.assigneeActor;
  if (row.target === 'project' && field === 'lead') return row.leadActor;
  if (row.target === 'program' && field === 'owner') return row.ownerActor;
  if (row.target === 'initiative' && field === 'owner') return row.ownerActor;
  return null;
}
