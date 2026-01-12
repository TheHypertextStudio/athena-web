'use client';

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNodesState, useEdgesState, type OnConnect, addEdge } from '@xyflow/react';
import { tasksApi, type Task } from '@/lib/api-client';
import { getLayoutedElements } from '../shared/layout-utils';
import type { TaskNodeType, TaskNodeData } from './TaskNode';
import type { DependencyEdgeType, DependencyEdgeData } from './DependencyEdge';

interface UseDependencyGraphOptions {
  rootTaskId?: string;
  projectId?: string;
  includeCompleted?: boolean;
}

interface DependencyGraphData {
  task: Task;
  dependencies: Task[];
  dependents: Task[];
}

const dependencyKeys = {
  all: ['task-dependencies'] as const,
  graph: (taskId: string) => [...dependencyKeys.all, 'graph', taskId] as const,
  projectGraph: (projectId: string) => [...dependencyKeys.all, 'project', projectId] as const,
};

/**
 * Fetches a task and its full dependency tree.
 */
async function fetchDependencyTree(
  taskId: string,
  visited = new Set<string>(),
): Promise<Map<string, DependencyGraphData>> {
  if (visited.has(taskId)) {
    return new Map();
  }
  visited.add(taskId);

  const taskResponse = await tasksApi.get(taskId);
  const task = taskResponse.data;
  const dependenciesResponse = await tasksApi.getDependencies(taskId);
  const dependencies = dependenciesResponse.data;

  const result = new Map<string, DependencyGraphData>();
  result.set(taskId, {
    task,
    dependencies,
    dependents: [],
  });

  for (const dep of dependencies) {
    const subTree = await fetchDependencyTree(dep.id, visited);
    for (const [id, data] of subTree) {
      if (!result.has(id)) {
        result.set(id, data);
      }
    }
    const depData = result.get(dep.id);
    if (depData) {
      depData.dependents.push(task);
    }
  }

  return result;
}

/**
 * Transforms task data into ReactFlow nodes and edges.
 */
function buildGraph(
  graphData: Map<string, DependencyGraphData>,
  options: { includeCompleted?: boolean } = {},
): { nodes: TaskNodeType[]; edges: DependencyEdgeType[] } {
  const { includeCompleted = false } = options;

  const nodes: TaskNodeType[] = [];
  const edges: DependencyEdgeType[] = [];
  const processedEdges = new Set<string>();

  for (const [taskId, data] of graphData) {
    const { task, dependencies, dependents } = data;

    if (!includeCompleted && task.status === 'completed') {
      continue;
    }

    const isBlocking = dependents.some(
      (dep) => dep.status !== 'completed' && dep.status !== 'cancelled',
    );

    const nodeData: TaskNodeData = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignee: (task as Task & { assignee?: { name?: string } }).assignee?.name ?? null,
      deadline: task.deadline,
      isBlocking,
      color: getStatusColor(task.status),
    };

    nodes.push({
      id: task.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: nodeData,
    });

    for (const dep of dependencies) {
      if (!includeCompleted && dep.status === 'completed') {
        continue;
      }

      const edgeId = `${dep.id}->${taskId}`;
      if (!processedEdges.has(edgeId)) {
        processedEdges.add(edgeId);

        const edgeData: DependencyEdgeData = {
          type: 'blocks',
          isOnCriticalPath: false,
        };

        edges.push({
          id: edgeId,
          source: dep.id,
          target: taskId,
          type: 'dependency',
          data: edgeData,
        });
      }
    }
  }

  return getLayoutedElements<TaskNodeType, DependencyEdgeType>(nodes, edges, {
    direction: 'LR',
    nodeSep: 80,
    rankSep: 150,
  });
}

function getStatusColor(status: Task['status']): string {
  switch (status) {
    case 'completed':
      return 'var(--md-sys-color-primary)';
    case 'in_progress':
      return 'var(--md-sys-color-tertiary)';
    case 'cancelled':
      return 'var(--md-sys-color-error)';
    default:
      return 'var(--md-sys-color-outline-variant)';
  }
}

/**
 * Hook for managing a task dependency graph.
 */
export function useDependencyGraph(options: UseDependencyGraphOptions = {}) {
  const { rootTaskId, includeCompleted = false } = options;
  const queryClient = useQueryClient();

  const {
    data: graphData,
    isLoading,
    error,
  } = useQuery({
    queryKey: dependencyKeys.graph(rootTaskId ?? ''),
    queryFn: async () => {
      if (!rootTaskId) return new Map<string, DependencyGraphData>();
      return fetchDependencyTree(rootTaskId);
    },
    enabled: !!rootTaskId,
  });

  const initialGraph = useMemo(() => {
    if (!graphData) return { nodes: [], edges: [] };
    return buildGraph(graphData, { includeCompleted });
  }, [graphData, includeCompleted]);

  const [nodes, _setNodes, onNodesChange] = useNodesState(initialGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges);

  const addDependencyMutation = useMutation({
    mutationFn: async ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) => {
      await tasksApi.addDependency(taskId, dependsOnId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dependencyKeys.all });
    },
  });

  const removeDependencyMutation = useMutation({
    mutationFn: async ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) => {
      await tasksApi.removeDependency(taskId, dependsOnId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dependencyKeys.all });
    },
  });

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) {
        addDependencyMutation.mutate({
          taskId: connection.target,
          dependsOnId: connection.source,
        });
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              type: 'dependency',
              data: { type: 'blocks' } as DependencyEdgeData,
            },
            eds,
          ),
        );
      }
    },
    [addDependencyMutation, setEdges],
  );

  const removeDependency = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        removeDependencyMutation.mutate({
          taskId: edge.target,
          dependsOnId: edge.source,
        });
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      }
    },
    [edges, removeDependencyMutation, setEdges],
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    removeDependency,
    isLoading,
    error,
    isAddingDependency: addDependencyMutation.isPending,
    isRemovingDependency: removeDependencyMutation.isPending,
  };
}

export { dependencyKeys };
