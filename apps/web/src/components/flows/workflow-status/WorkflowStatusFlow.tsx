'use client';

import { useCallback } from 'react';
import {
  type Node,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  Panel,
} from '@xyflow/react';
import { FlowSurface } from '../FlowSurface';
import { StatusNode } from './StatusNode';
import { useWorkflowGraph, CATEGORY_ORDER } from './useWorkflowGraph';
import { useFlowExport } from '@/hooks/use-flow-export';
import { cn } from '@/lib/utils';

export interface WorkflowStatusFlowProps {
  workspaceId?: string;
  title?: string;
  showMinimap?: boolean;
  showControls?: boolean;
  onNodeClick?: (statusId: string) => void;
  className?: string;
}

const nodeTypes: NodeTypes = {
  status: StatusNode,
};

const categoryLabels = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const categoryColors = {
  not_started: 'bg-surface-variant',
  in_progress: 'bg-tertiary-container/30',
  done: 'bg-primary-container/30',
  cancelled: 'bg-error-container/30',
};

/**
 * Visual workflow status editor.
 *
 * Displays task statuses organized in swim lanes by category:
 * - Not Started → In Progress → Done → Cancelled
 *
 * @example
 * ```tsx
 * <WorkflowStatusFlow
 *   workspaceId={workspaceId}
 *   title="Task Workflow"
 *   onNodeClick={(id) => openStatusEditor(id)}
 * />
 * ```
 */
export function WorkflowStatusFlow({
  workspaceId,
  title = 'Task Workflow',
  showMinimap = false,
  showControls = true,
  onNodeClick,
  className,
}: WorkflowStatusFlowProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, isLoading, error } = useWorkflowGraph({
    workspaceId,
  });

  const { exportToPng } = useFlowExport({
    fileName: 'workflow-status',
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

  if (isLoading) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <div className="text-on-surface-variant flex items-center gap-2">
          <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          <span>Loading workflow...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-error bg-error-container flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-error-container">Failed to load workflow</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-surface-variant">No statuses found</p>
      </div>
    );
  }

  return (
    <FlowSurface
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange as OnNodesChange}
      onEdgesChange={onEdgesChange as OnEdgesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      title={title}
      showMinimap={showMinimap}
      showControls={showControls}
      onExport={handleExport}
      fitView
      className={className}
    >
      {/* Swim lane headers */}
      <Panel position="top-left" className="pointer-events-none ml-2 flex gap-[60px]">
        {CATEGORY_ORDER.map((category) => (
          <div
            key={category}
            className={cn(
              'flex w-[180px] items-center justify-center rounded-lg px-3 py-1.5',
              categoryColors[category],
            )}
          >
            <span className="text-on-surface text-sm font-medium">{categoryLabels[category]}</span>
          </div>
        ))}
      </Panel>
    </FlowSurface>
  );
}
