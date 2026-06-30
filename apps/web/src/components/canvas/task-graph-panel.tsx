'use client';

/**
 * `components/canvas/task-graph-panel` — the dependency-graph embed.
 *
 * @remarks
 * The thin wrapper every host renders: it feeds {@link useTaskGraph} for a scope into the
 * generic {@link Canvas}, and owns the loading / empty / error states so hosts stay declarative.
 * Clicking a node navigates to that task's detail page. Whatever `onExpand` the host passes is
 * forwarded to the canvas's expand affordance (the host decides where "expand" goes).
 */
import { EmptyState } from '@docket/ui/components';
import { Workflow } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import Canvas from './canvas';
import TaskNode from './task-node';
import type { CanvasDensity } from './use-dagre-layout';
import { type TaskGraphScope, useTaskGraph } from './use-task-graph';

/** Stable node-type registry (must not be re-created per render — xyflow warns otherwise). */
const NODE_TYPES = { task: TaskNode };

/** Props for {@link TaskGraphPanel}. */
export interface TaskGraphPanelProps {
  /** The scope to render (org / project / task-neighborhood). */
  scope: TaskGraphScope;
  /** Canvas density; default `compact` since the common host is an embed. */
  density?: CanvasDensity;
  /** When set, shows an expand affordance that calls this (e.g. navigate to the full view). */
  onExpand?: () => void;
  /** Extra classes for the container. */
  className?: string;
}

/** A scoped dependency-graph canvas with loading/empty/error handling. */
export default function TaskGraphPanel({
  scope,
  density = 'compact',
  onExpand,
  className,
}: TaskGraphPanelProps): React.JSX.Element {
  const router = useRouter();
  const { nodes, edges, isLoading, error, isEmpty } = useTaskGraph(scope, density);

  const onNodeClick = useCallback(
    (id: string) => {
      router.push(`/orgs/${scope.orgId}/tasks/${id}`);
    },
    [router, scope.orgId],
  );

  if (isLoading) {
    return <Skeleton className={cn('h-full min-h-0 w-full rounded-lg', className)} />;
  }
  if (error !== null) {
    return (
      <div className={cn('flex h-full min-h-0 w-full items-center justify-center p-4', className)}>
        <EmptyState
          icon={Workflow}
          tone="neutral"
          title="Couldn’t load the graph"
          body={error}
        />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className={cn('flex h-full min-h-0 w-full items-center justify-center p-4', className)}>
        <EmptyState
          icon={Workflow}
          tone="neutral"
          title="No dependencies yet"
          body="Tasks in this scope have no dependency or subtask links to map."
        />
      </div>
    );
  }

  return (
    <Canvas
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      density={density}
      onExpand={onExpand}
      onNodeClick={onNodeClick}
      className={className}
    />
  );
}
