'use client';

import { useCallback } from 'react';
import {
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import { FlowSurface } from '../FlowSurface';
import { TaskNode } from './TaskNode';
import { DependencyEdge } from './DependencyEdge';
import { useDependencyGraph } from './useDependencyGraph';
import { useFlowExport } from '@/hooks/use-flow-export';

export interface TaskDependencyFlowProps {
  rootTaskId: string;
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
 * Users can click nodes to view task details and drag to create new dependencies.
 *
 * @example
 * ```tsx
 * <TaskDependencyFlow
 *   rootTaskId={taskId}
 *   title="Dependencies"
 *   onNodeClick={(id) => openTaskModal(id)}
 * />
 * ```
 */
export function TaskDependencyFlow({
  rootTaskId,
  title = 'Task Dependencies',
  showMinimap = true,
  showControls = true,
  onNodeClick,
  onExpand,
  includeCompleted = false,
  className,
}: TaskDependencyFlowProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    removeDependency,
    isLoading,
    error,
  } = useDependencyGraph({ rootTaskId, includeCompleted });

  const { exportToPng } = useFlowExport({
    fileName: `task-dependencies-${rootTaskId}`,
  });

  const handleExport = useCallback(() => {
    void exportToPng();
  }, [exportToPng]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick],
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (window.confirm('Remove this dependency?')) {
        removeDependency(edge.id);
      }
    },
    [removeDependency],
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
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-surface-variant">No dependencies found</p>
      </div>
    );
  }

  return (
    <FlowSurface
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange as OnNodesChange}
      onEdgesChange={onEdgesChange as OnEdgesChange}
      onConnect={onConnect}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      title={title}
      showMinimap={showMinimap}
      showControls={showControls}
      onExport={handleExport}
      onExpand={onExpand}
      className={className}
    />
  );
}
