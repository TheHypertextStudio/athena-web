'use client';

import { useMemo, useCallback } from 'react';
import { useNodesState, useEdgesState, type Edge } from '@xyflow/react';
import {
  useGroupedStatuses,
  type CustomTaskStatus,
  type TaskStatusCategory,
} from '@/hooks/use-custom-statuses';
import { getSwimLaneLayout } from '../shared/layout-utils';
import type { StatusNodeType, StatusNodeData } from './StatusNode';

interface UseWorkflowGraphOptions {
  workspaceId?: string;
}

const CATEGORY_ORDER: TaskStatusCategory[] = ['not_started', 'in_progress', 'done', 'cancelled'];

const categoryColors = {
  not_started: 'var(--md-sys-color-outline-variant)',
  in_progress: 'var(--md-sys-color-tertiary)',
  done: 'var(--md-sys-color-primary)',
  cancelled: 'var(--md-sys-color-error)',
};

/**
 * Build workflow graph nodes and edges from task statuses.
 */
function buildWorkflowGraph(groupedStatuses: Record<TaskStatusCategory, CustomTaskStatus[]>): {
  nodes: StatusNodeType[];
  edges: Edge[];
} {
  const nodes: StatusNodeType[] = [];
  const edges: Edge[] = [];

  // Create nodes for each status
  for (const category of CATEGORY_ORDER) {
    const statuses = groupedStatuses[category];
    for (const status of statuses) {
      const nodeData: StatusNodeData = {
        id: status.id,
        name: status.name,
        category: status.category,
        color: status.color,
        isDefault: status.isDefault,
        position: status.position,
      };

      nodes.push({
        id: status.id,
        type: 'status',
        position: { x: 0, y: 0 },
        data: nodeData,
      });
    }
  }

  // Apply swim lane layout
  const layoutedNodes = getSwimLaneLayout(
    nodes.map((n) => ({ ...n, data: { ...n.data, category: n.data.category } })),
    CATEGORY_ORDER,
    {
      laneWidth: 180,
      laneGap: 60,
      nodeHeight: 70,
      nodeGap: 16,
      startX: 40,
      startY: 40,
    },
  );

  // Create edges between adjacent categories (typical workflow progression)
  for (let i = 0; i < CATEGORY_ORDER.length - 1; i++) {
    const fromCategory = CATEGORY_ORDER[i];
    const toCategory = CATEGORY_ORDER[i + 1];

    if (!fromCategory || !toCategory) continue;

    const fromStatuses = groupedStatuses[fromCategory];
    const toStatuses = groupedStatuses[toCategory];

    // Connect default statuses of adjacent categories
    const fromDefault = fromStatuses.find((s) => s.isDefault) ?? fromStatuses[0];
    const toDefault = toStatuses.find((s) => s.isDefault) ?? toStatuses[0];

    if (fromDefault && toDefault) {
      edges.push({
        id: `${fromDefault.id}->${toDefault.id}`,
        source: fromDefault.id,
        target: toDefault.id,
        type: 'smoothstep',
        style: {
          stroke: categoryColors[toCategory],
          strokeWidth: 2,
        },
      });
    }
  }

  return { nodes: layoutedNodes as StatusNodeType[], edges };
}

/**
 * Hook for managing a workflow status graph.
 */
export function useWorkflowGraph(options: UseWorkflowGraphOptions = {}) {
  const { workspaceId } = options;

  const { groupedStatuses, isLoading, error } = useGroupedStatuses(workspaceId);

  const initialGraph = useMemo(() => {
    return buildWorkflowGraph(groupedStatuses);
  }, [groupedStatuses]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  const updateNodePosition = useCallback(
    (nodeId: string, newCategory: TaskStatusCategory, newPosition: number) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                category: newCategory,
                position: newPosition,
              },
            };
          }
          return node;
        }),
      );
    },
    [setNodes],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    updateNodePosition,
    isLoading,
    error,
    categoryOrder: CATEGORY_ORDER,
  };
}

export { CATEGORY_ORDER };
