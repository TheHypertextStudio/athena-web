'use client';

/**
 * The task page's loading surface: the real detail layout, stating what a snapshot already knows.
 *
 * @remarks
 * Built on {@link EntityDetailSkeleton}, so the masthead, property row, and tab bar occupy exactly
 * the geometry of the loaded page and content arrives without moving anything. A navigation
 * snapshot seeded by the list row the reader clicked supplies the title, glyph, status, and
 * priority; the properties only the detail read can answer keep placeholders in their own slots.
 */
import { defaultEntityDisplay } from '@docket/work/entity-display-contract';
import { StatusIcon } from '@docket/ui/components';
import { SkeletonChip } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { EntityIconSlot } from '@/components/entity-display/entity-icon-glyph';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import {
  EntityMetadataItem,
  EntityMetadataStaticChip,
  type EntityMetadataPriority,
} from '@/components/views/entity-detail-layout';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import type { TaskNavigationSnapshot } from '@/lib/contracts/entity-navigation';

import { PRIORITY_LABEL } from './priority';
import { PriorityGlyph } from './PriorityGlyph';

/** Props for the structured Task loading layout. */
export interface TaskDetailLoadingProps {
  /** Identity already known from a list row, if navigation supplied one. */
  snapshot?: TaskNavigationSnapshot | null | undefined;
}

/** The status the snapshot carries, resolved through the workspace's own set. */
function SnapshotStatusChip({ statusKey }: { readonly statusKey: string }): JSX.Element {
  const status = useWorkStatus('task', statusKey);
  return (
    <EntityMetadataStaticChip
      icon={<StatusIcon type={status.category} label={status.name} />}
      label={status.name}
      ariaLabel="Status"
    />
  );
}

/** A placeholder standing in one property's slot. */
function PendingProperty({ priority }: { readonly priority: EntityMetadataPriority }): JSX.Element {
  return (
    <EntityMetadataItem priority={priority}>
      {/* placeholder: a property whose value only the task's detail read can answer. */}
      <SkeletonChip />
    </EntityMetadataItem>
  );
}

/** The lead property row for a task known only by its snapshot. */
function SnapshotMetadata({
  snapshot,
}: {
  readonly snapshot: TaskNavigationSnapshot;
}): JSX.Element {
  return (
    <>
      <EntityMetadataItem priority={0}>
        <SnapshotStatusChip statusKey={snapshot.status} />
      </EntityMetadataItem>
      <EntityMetadataItem priority={0}>
        <EntityMetadataStaticChip
          icon={<PriorityGlyph priority={snapshot.priority} />}
          label={PRIORITY_LABEL[snapshot.priority]}
          ariaLabel="Priority"
        />
      </EntityMetadataItem>
      <PendingProperty priority={1} />
      <PendingProperty priority={2} />
      <PendingProperty priority={3} />
    </>
  );
}

/**
 * Render the Task page's loading structure without hiding identity data that already exists.
 *
 * @param props - The optional local identity snapshot.
 * @returns The Task-shaped loading surface.
 */
export function TaskDetailLoading({ snapshot }: TaskDetailLoadingProps): JSX.Element {
  return (
    <EntityDetailSkeleton
      entityName="Task"
      tabCount={3}
      chipCount={5}
      hasSubtitle={false}
      title={snapshot?.title}
      icon={
        snapshot ? (
          <EntityIconSlot
            display={defaultEntityDisplay('task', snapshot.id)}
            entityName={snapshot.title}
            size={48}
          />
        ) : undefined
      }
      snapshotMetadata={snapshot ? <SnapshotMetadata snapshot={snapshot} /> : undefined}
    />
  );
}
