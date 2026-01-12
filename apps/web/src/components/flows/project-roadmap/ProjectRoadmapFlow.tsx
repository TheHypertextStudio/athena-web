'use client';

import { useCallback } from 'react';
import {
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';
import { FlowSurface } from '../FlowSurface';
import { InitiativeNode } from './InitiativeNode';
import { ProjectNode } from './ProjectNode';
import { TimelineEdge } from './TimelineEdge';
import { useRoadmapGraph } from './useRoadmapGraph';

export interface ProjectRoadmapFlowProps {
  initiativeId?: string;
  title?: string;
  showMinimap?: boolean;
  showControls?: boolean;
  onNodeClick?: (nodeId: string, nodeType: 'initiative' | 'project') => void;
  onExpand?: () => void;
  includeCompleted?: boolean;
  className?: string;
}

const nodeTypes: NodeTypes = {
  initiative: InitiativeNode,
  project: ProjectNode,
};

const edgeTypes: EdgeTypes = {
  timeline: TimelineEdge,
};

/**
 * Project roadmap visualization showing initiatives and projects.
 *
 * Displays strategic hierarchy:
 * - Initiatives at the top level
 * - Projects grouped under initiatives
 * - Progress and deadline information
 *
 * @example
 * ```tsx
 * <ProjectRoadmapFlow
 *   title="Q1 Roadmap"
 *   onNodeClick={(id, type) => openDetail(id, type)}
 * />
 * ```
 */
export function ProjectRoadmapFlow({
  initiativeId,
  title = 'Project Roadmap',
  showMinimap = true,
  showControls = true,
  onNodeClick,
  onExpand,
  includeCompleted = false,
  className,
}: ProjectRoadmapFlowProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, isLoading, error } = useRoadmapGraph({
    initiativeId,
    includeCompleted,
  });

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        const nodeType = node.type === 'initiative' ? 'initiative' : 'project';
        onNodeClick(node.id, nodeType);
      }
    },
    [onNodeClick],
  );

  if (isLoading) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <div className="text-on-surface-variant flex items-center gap-2">
          <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          <span>Loading roadmap...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-error bg-error-container flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-error-container">Failed to load roadmap</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="border-outline-variant bg-surface flex h-64 items-center justify-center rounded-xl border">
        <p className="text-on-surface-variant">No initiatives or projects found</p>
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
      edgeTypes={edgeTypes}
      title={title}
      showMinimap={showMinimap}
      showControls={showControls}
      exportFileName={`roadmap-${initiativeId ?? 'all'}`}
      onExpand={onExpand}
      className={className}
    />
  );
}
