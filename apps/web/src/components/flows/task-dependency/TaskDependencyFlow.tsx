'use client';

import { useCallback, useMemo } from 'react';
import {
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
} from '@xyflow/react';
import { FlowSurface } from '../FlowSurface';
import { TaskNode } from './TaskNode';
import { DependencyEdge } from './DependencyEdge';
import { useDependencyGraph } from './useDependencyGraph';
import { useSelection } from '@/components/objects/context/SelectionContext';
import { surfaceId } from '@/components/objects/types';

const SURFACE_ID = surfaceId('task-dependency-graph');

export interface TaskDependencyFlowProps {
  /** Single task mode - shows task and its dependency tree */
  rootTaskId?: string;
  /** Project mode - shows all tasks in project with dependencies */
  projectId?: string;
  title?: string;
  showMinimap?: boolean;
  showControls?: boolean;
  onNodeClick?: (taskId: string) => void;
  onExpand?: () => void;
  includeCompleted?: boolean;
  className?: string;
}

const nodeTypes: NodeTypes = {
  task: TaskNode,
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
};

/**
 * Interactive task dependency graph visualization.
 *
 * Displays tasks and their blocking relationships in a directed graph.
 * Supports two modes:
 * - `rootTaskId`: Shows a single task and its dependency tree
 * - `projectId`: Shows all tasks in a project with their dependencies
 *
 * Integrates with SelectionContext for multi-select behavior.
 *
 * @example
 * ```tsx
 * // Single task mode
 * <TaskDependencyFlow
 *   rootTaskId={taskId}
 *   title="Dependencies"
 *   onNodeClick={(id) => openTaskModal(id)}
 * />
 *
 * // Project mode
 * <TaskDependencyFlow
 *   projectId={projectId}
 *   title="Project Dependencies"
 *   onNodeClick={(id) => openTaskModal(id)}
 * />
 * ```
 */
export function TaskDependencyFlow({
  rootTaskId,
  projectId,
  title = 'Task Dependencies',
  showMinimap = true,
  showControls = true,
  onNodeClick,
  onExpand,
  includeCompleted = false,
  className,
}: TaskDependencyFlowProps) {
  const {
    nodes: graphNodes,
    edges,
    topologicalOrder,
    onNodesChange,
    onEdgesChange,
    onConnect,
    removeDependency,
    isLoading,
    error,
  } = useDependencyGraph({ rootTaskId, projectId, includeCompleted });

  const { select, toggle, selectRange, isSelected, state } = useSelection();

  // Update nodes with selection state from SelectionContext
  const nodes = useMemo(() => {
    return graphNodes.map((node) => ({
      ...node,
      selected: isSelected(node.id),
    }));
  }, [graphNodes, isSelected]);

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Multi-select behavior
      if (event.shiftKey && state.anchor) {
        selectRange(state.anchor, node.id, topologicalOrder, SURFACE_ID);
      } else if (event.metaKey || event.ctrlKey) {
        toggle(node.id, SURFACE_ID);
      } else {
        select(node.id, SURFACE_ID);
      }

      // Notify parent
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [state.anchor, topologicalOrder, select, toggle, selectRange, onNodeClick],
  );

  // Edge context menu instead of window.confirm
  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      // For now, just remove the dependency - proper context menu will be added later
      removeDependency(edge.id);
    },
    [removeDependency],
  );

  // Filter onNodesChange to only allow selection changes (no position changes)
  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Only allow selection changes, filter out position changes
      const allowedChanges = changes.filter(
        (change) => change.type === 'select' || change.type === 'remove',
      );
      onNodesChange(allowedChanges);
    },
    [onNodesChange],
  );

  if (isLoading) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <div className="text-on-surface-variant flex items-center gap-2">
          <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          <span>Loading dependencies...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-error bg-error-container flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-error-container">Failed to load dependencies</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 flex-col items-center justify-center rounded-xl border">
        <p className="text-on-surface-variant">No tasks found</p>
        <p className="text-on-surface-variant/60 mt-1 text-sm">
          {projectId ? 'Create tasks to see their dependencies' : 'This task has no dependencies'}
        </p>
      </div>
    );
  }

  const exportFileName = (() => {
    if (projectId) {
      const id = projectId;
      return `project-dependencies-${id}`;
    }
    if (rootTaskId) {
      const id = rootTaskId;
      return `task-dependencies-${id}`;
    }
    return 'task-dependencies';
  })();

  return (
    <FlowSurface
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeContextMenu}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      title={title}
      showMinimap={showMinimap}
      showControls={showControls}
      exportFileName={exportFileName}
      onExpand={onExpand}
      nodesDraggable={false}
      nodesConnectable={false}
      className={className}
    />
  );
}
