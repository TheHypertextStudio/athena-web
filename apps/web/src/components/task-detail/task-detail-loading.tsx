import type { TaskNavigationSnapshot } from '../../lib/contracts/entity-navigation';
import { Skeleton, SkeletonChip, SkeletonText } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { PRIORITY_LABEL } from './priority';
import { TaskHeaderControls } from './task-header-controls';

/** Props for the structured Task loading layout. */
export interface TaskDetailLoadingProps {
  /** Identity already known from a list row, if navigation supplied one. */
  snapshot?: TaskNavigationSnapshot | null | undefined;
}

/**
 * Render the Task page's loading structure without hiding identity data that already exists.
 *
 * @param props - The optional local identity snapshot.
 * @returns The Task-shaped loading surface.
 */
export function TaskDetailLoading({ snapshot }: TaskDetailLoadingProps): JSX.Element {
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
              <span className="bg-surface-container text-on-surface-variant text-body-small rounded-full px-3 py-1">
                Status: {snapshot.status.replaceAll('_', ' ')}
              </span>
            ) : (
              <SkeletonChip className="w-32" />
            )
          }
          priority={
            snapshot ? (
              <span className="bg-surface-container text-on-surface-variant text-body-small rounded-full px-3 py-1">
                Priority: {PRIORITY_LABEL[snapshot.priority]}
              </span>
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
