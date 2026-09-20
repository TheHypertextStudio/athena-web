'use client';

import type { SourcePersonReferenceOut } from '@docket/connections/integration-contract';
import type { ActorPickerProps } from '@docket/ui/components';
import type { JSX } from 'react';
import { SourcePersonControl } from './source-person-control';
import { WorkspaceActorPicker } from './workspace-actor-picker';

/** The read-side source evidence shared by entity details and work rows. */
export interface SourcePeopleEntity {
  readonly organizationId: string;
  readonly sourcePeople?: readonly SourcePersonReferenceOut[] | undefined;
}

/** Render source names for a field without treating unresolved evidence as an empty assignment. */
export function renderSourcePeople(entity: SourcePeopleEntity, field: string): JSX.Element | null {
  const sources = entity.sourcePeople?.filter((source) => source.field === field) ?? [];
  if (!sources.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {sources.map((source) => (
        <SourcePersonControl key={source.id} orgId={entity.organizationId} source={source} />
      ))}
    </div>
  );
}

/** Edit a native person reference while retaining visible unresolved source evidence. */
export function SourceAwareActorPicker({
  entity,
  field,
  ...props
}: ActorPickerProps & {
  readonly entity: SourcePeopleEntity;
  readonly field: string;
}): JSX.Element {
  const sources = renderSourcePeople(entity, field);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {props.value ? null : sources}
      <WorkspaceActorPicker
        clearLabel="Unassigned"
        ariaLabel="Assignee"
        triggerVariant="secondary"
        triggerClassName="min-w-0 shrink"
        {...props}
        orgId={entity.organizationId}
        placeholder={sources ? 'Change assignee' : (props.placeholder ?? 'Assign')}
      />
    </div>
  );
}
