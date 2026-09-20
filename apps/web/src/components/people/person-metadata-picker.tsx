'use client';

import type { JSX } from 'react';
import type { ActorPickerProps } from '@docket/ui/components';
import {
  EntityMetadataItem,
  type EntityMetadataPriority,
} from '@/components/views/entity-detail-layout';
import { WorkspaceActorPicker } from './workspace-actor-picker';

/** Person selection and inline creation in the shared entity metadata row. */
export function PersonMetadataPicker({
  priority,
  field,
  ...props
}: ActorPickerProps & {
  orgId?: string | undefined;
  priority: EntityMetadataPriority;
  field: 'Assignee' | 'Owner' | 'Lead';
}): JSX.Element {
  const empty = field === 'Assignee' ? 'Unassigned' : `No ${field.toLowerCase()}`;
  return (
    <EntityMetadataItem priority={priority}>
      <WorkspaceActorPicker {...props} placeholder={empty} clearLabel={empty} ariaLabel={field} />
    </EntityMetadataItem>
  );
}
