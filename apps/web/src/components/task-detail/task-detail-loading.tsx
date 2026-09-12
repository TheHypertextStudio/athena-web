'use client';

import type { TaskNavigationSnapshot } from '../../lib/contracts/entity-navigation';
import { StatusIcon } from '@docket/ui/components';
import { Button, Skeleton, SkeletonChip, SkeletonText } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { useWorkStatus } from '@/components/entity-display/use-work-status';

import { PRIORITY_LABEL } from './priority';
import { PriorityGlyph } from './PriorityGlyph';
import { TaskHeaderControls } from './task-header-controls';

/** Props for the structured Task loading layout. */
export interface TaskDetailLoadingProps {
  /** Identity already known from a list row, if navigation supplied one. */
  snapshot?: TaskNavigationSnapshot | null | undefined;
}

/** Props for {@link SnapshotStatusControl}. */
interface SnapshotStatusControlProps {
  /** The stored status key the snapshot carries. */
  statusKey: string;
}

/**
 * The Task header's status control, stated rather than editable.
 *
 * @remarks
 * Matches {@link import('./StatusPicker').StatusPicker}'s own read-only branch — the outline
 * trigger it falls back to before the team's workflow arrives — so the control does not resize when
 * the real picker replaces it. The name comes from the workspace's set: a status key is an
 * identifier, and printing it showed `in_review` to a workspace that had named that stage something
 * else.
 *
 * @param props - The {@link SnapshotStatusControlProps}.
 * @returns the stated status control.
 */
function SnapshotStatusControl({ statusKey }: SnapshotStatusControlProps): JSX.Element {
  const status = useWorkStatus('task', statusKey);
  return (
    <Button variant="outline" size="sm" disabled className="gap-2">
      <StatusIcon type={status.category} label={status.name} />
      {status.name}
    </Button>
  );
}

/**
 * Render the Task page's loading structure without hiding identity data that already exists.
 *
 * @param props - The optional local identity snapshot.
 * @returns The Task-shaped loading surface.
 */
export function TaskDetailLoading({ snapshot }: TaskDetailLoadingProps): JSX.Element {
  // placeholder: the Task's assignee, its actions and its body — the parts of the record that only
  // the detail read can answer. Its title, status and priority are not among them whenever a
  // snapshot is in hand, which is why each of those is stated above rather than placeheld.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Task detail"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8"
    >
      <header className="flex flex-col gap-4">
        {snapshot ? (
          <h1 className="text-on-surface text-title-large">{snapshot.title}</h1>
        ) : (
          <SkeletonText scale="title" className="w-2/3 max-w-lg" />
        )}
        <TaskHeaderControls
          status={
            snapshot ? (
              <SnapshotStatusControl statusKey={snapshot.status} />
            ) : (
              <SkeletonChip className="w-32" />
            )
          }
          priority={
            snapshot ? (
              <Button variant="outline" size="sm" disabled className="gap-2">
                <PriorityGlyph priority={snapshot.priority} />
                {PRIORITY_LABEL[snapshot.priority]}
              </Button>
            ) : (
              <SkeletonChip className="w-28" />
            )
          }
          assignee={<SkeletonChip className="w-24" />}
          actions={<SkeletonChip className="w-20" />}
          overflow={<Skeleton className="size-8 rounded-full" />}
        />
      </header>
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
