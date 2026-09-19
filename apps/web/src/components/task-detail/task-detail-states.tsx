'use client';

/**
 * Everything the task page shows in place of the task: loading, gone, and failed to load.
 *
 * @remarks
 * The page decides *which* of these applies with {@link resolveTaskDetailView} and renders the
 * result with {@link TaskDetailFallback}, so the page component holds one branch rather than four.
 * Loading is the real detail layout ({@link TaskDetailLoading}); a task that is gone or off limits
 * is an empty state with the one place to go next; a failed read is the shared load-failure state,
 * whose copy comes from the failure's class and never from server text.
 */
import { EmptyState } from '@docket/ui/components';
import { CircleAlert, Shield } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { QueryLoadFailure } from '@/components/query-load-failure';
import type { TaskNavigationSnapshot } from '@/lib/contracts/entity-navigation';
import type { TaskReadState } from '@/lib/use-task-detail';

import { TaskDetailLoading } from './task-detail-loading';

/** Why a task the reader opened is no longer available. */
export type TaskTerminalState = 'forbidden' | 'not-found';

/** Which surface the task page shows. */
export type TaskDetailView = 'loading' | 'unavailable' | 'failed' | 'ready';

/** What {@link resolveTaskDetailView} decides from. */
export interface TaskDetailViewInput {
  /** The task read has not settled. */
  readonly isPending: boolean;
  /** The read settled on a deletion or a revoked grant. */
  readonly terminalState: TaskTerminalState | null;
  /** The read settled on an error. */
  readonly isError: boolean;
  /** A task record is in hand. */
  readonly hasTask: boolean;
}

/**
 * Pick the surface for the task page's current read state.
 *
 * @param input - The read state.
 * @returns `ready` only when a task is in hand and nothing has gone wrong.
 */
export function resolveTaskDetailView({
  isPending,
  terminalState,
  isError,
  hasTask,
}: TaskDetailViewInput): TaskDetailView {
  if (isPending) return 'loading';
  if (terminalState !== null) return 'unavailable';
  if (isError) return 'failed';
  return hasTask ? 'ready' : 'unavailable';
}

/** Props for {@link TaskDetailFallback}. */
export interface TaskDetailFallbackProps {
  /** Which surface to show. */
  readonly view: TaskDetailView;
  readonly orgId: string;
  /** Why the task is unavailable, when the read said; a missing record reads as gone. */
  readonly terminalState: TaskTerminalState | null;
  /** The identity the list row seeded, painted while the read is in flight. */
  readonly snapshot: TaskNavigationSnapshot | null;
  /** The task read, for presenting its failure and retrying it. */
  readonly query: TaskReadState;
}

/** A task that is gone or off limits, with the one place to go next. */
function TaskUnavailable({
  orgId,
  terminalState,
}: {
  readonly orgId: string;
  readonly terminalState: TaskTerminalState | null;
}): JSX.Element {
  const forbidden = terminalState === 'forbidden';
  return (
    <div role="alert" className="flex min-h-64 flex-1 items-center justify-center p-6">
      <EmptyState
        frame="none"
        icon={forbidden ? Shield : CircleAlert}
        title={forbidden ? 'You no longer have access to this task' : 'This task no longer exists'}
        action={
          <Button asChild variant="outline">
            <Link href={`/orgs/${orgId}/my-work`}>Back to your work</Link>
          </Button>
        }
      />
    </div>
  );
}

/**
 * Render the task page's stand-in for a task that is not on screen.
 *
 * @param props - See {@link TaskDetailFallbackProps}.
 * @returns the loading layout, the unavailable state, or the load failure.
 */
export function TaskDetailFallback({
  view,
  orgId,
  terminalState,
  snapshot,
  query,
}: TaskDetailFallbackProps): JSX.Element {
  switch (view) {
    case 'loading':
      return <TaskDetailLoading snapshot={snapshot} />;
    case 'failed':
      return <QueryLoadFailure title="This task" query={query} />;
    // `ready` never reaches here with a task in hand; without one, the task is gone.
    case 'ready':
    case 'unavailable':
      return <TaskUnavailable orgId={orgId} terminalState={terminalState} />;
  }
}
