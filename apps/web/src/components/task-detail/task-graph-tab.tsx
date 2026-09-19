'use client';

/**
 * The task's Graph tab: its dependency neighbourhood, two hops out, on a canvas.
 *
 * @remarks
 * Mounted only while the tab is showing, so the graph read and its canvas are not paid for until
 * someone opens it. The canvas runs at full density, where a click peeks at a task and the
 * expand action opens the workspace graph focused on this task.
 */
import type { JSX } from 'react';

import TaskGraphPanel from '@/components/canvas/task-graph-panel';
import { useAppRouter } from '@/lib/interactions/navigation';

/** Props for {@link TaskGraphTab}. */
export interface TaskGraphTabProps {
  readonly orgId: string;
  readonly taskId: string;
}

/**
 * Render the task's dependency graph in a tonal panel.
 *
 * @param props - See {@link TaskGraphTabProps}.
 * @returns the graph canvas.
 */
export function TaskGraphTab({ orgId, taskId }: TaskGraphTabProps): JSX.Element {
  const router = useAppRouter();
  return (
    <div className="bg-surface-container h-[36rem] overflow-hidden rounded-xl">
      <TaskGraphPanel
        scope={{ orgId, rootTaskId: taskId, depth: 2 }}
        density="full"
        onExpand={() => {
          router.push(`/orgs/${orgId}/graph?rootTaskId=${taskId}`);
        }}
      />
    </div>
  );
}
