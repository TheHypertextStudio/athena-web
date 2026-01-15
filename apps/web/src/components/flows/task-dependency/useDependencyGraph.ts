'use client';

import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OnNodesChange, OnEdgesChange, OnConnect } from '@xyflow/react';
import { tasksApi, projectsApi, type Task, type TaskDependencyGraphData } from '@/lib/api-client';
import { getLayoutedElements } from '../shared/layout-utils';
import type { TaskNodeType, TaskNodeData } from './TaskNode';
import type { DependencyEdgeType, DependencyEdgeData } from './DependencyEdge';

/** Layout configuration for the dependency graph */
const GRAPH_LAYOUT = {
  /** Direction: left-to-right */
  direction: 'LR' as const,
  /** Horizontal spacing between nodes */
  nodeSep: 80,
  /** Vertical spacing between ranks/layers */
  rankSep: 150,
};

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

  return getLayoutedElements<TaskNodeType, DependencyEdgeType>(nodes, edges, GRAPH_LAYOUT);
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
 * Transforms project dependency graph data into ReactFlow nodes and edges.
 */
function buildProjectGraph(graphData: TaskDependencyGraphData): {
  nodes: TaskNodeType[];
  edges: DependencyEdgeType[];
} {
  const { tasks, dependencies } = graphData;

  // Build a map of task dependencies for calculating isBlocking
  const taskDependents = new Map<string, string[]>();
  for (const dep of dependencies) {
    const existing = taskDependents.get(dep.dependsOnTaskId) ?? [];
    existing.push(dep.taskId);
    taskDependents.set(dep.dependsOnTaskId, existing);
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const nodes: TaskNodeType[] = tasks.map((task) => {
    const dependentIds = taskDependents.get(task.id) ?? [];
    const isBlocking = dependentIds.some((depId) => {
      const dependent = taskMap.get(depId);
      return dependent && dependent.status !== 'completed' && dependent.status !== 'cancelled';
    });

    const nodeData: TaskNodeData = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignee: task.assignee?.name ?? null,
      deadline: task.deadline,
      isBlocking,
      color: getStatusColor(task.status),
    };

    return {
      id: task.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: nodeData,
    };
  });

  const edges: DependencyEdgeType[] = dependencies.map((dep) => {
    const edgeData: DependencyEdgeData = {
      type: 'blocks',
      isOnCriticalPath: false,
    };

    return {
      id: `${dep.dependsOnTaskId}->${dep.taskId}`,
      source: dep.dependsOnTaskId,
      target: dep.taskId,
      type: 'dependency',
      data: edgeData,
    };
  });

  return getLayoutedElements<TaskNodeType, DependencyEdgeType>(nodes, edges, GRAPH_LAYOUT);
}

/**
 * Computes topological order of nodes using Kahn's algorithm.
 * Returns node IDs sorted from roots (no dependencies) to leaves.
 */
function computeTopologicalOrder(nodes: TaskNodeType[], edges: DependencyEdgeType[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency list and in-degree counts
  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  // Start with nodes that have no incoming edges (roots)
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If there are remaining nodes (cycle), add them at the end
  for (const node of nodes) {
    if (!result.includes(node.id)) {
      result.push(node.id);
    }
  }

  return result;
}

/**
 * Hook for managing a task dependency graph.
 *
 * Supports two modes:
 * - `rootTaskId`: Fetches a single task and its dependency tree (N+1 queries)
 * - `projectId`: Fetches all tasks in a project with their dependencies (single query)
 */
export function useDependencyGraph(options: UseDependencyGraphOptions = {}) {
  const { rootTaskId, projectId, includeCompleted = false } = options;
  const queryClient = useQueryClient();

  // Determine which mode we're in
  const mode = projectId ? 'project' : rootTaskId ? 'task' : 'none';

  // Query for single task mode (existing behavior)
  const taskQuery = useQuery({
    queryKey: dependencyKeys.graph(rootTaskId ?? ''),
    queryFn: async () => {
      if (!rootTaskId) return new Map<string, DependencyGraphData>();
      return fetchDependencyTree(rootTaskId);
    },
    enabled: mode === 'task',
  });

  // Query for project mode (new behavior - single request)
  const projectQuery = useQuery({
    queryKey: dependencyKeys.projectGraph(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return null;
      const response = await projectsApi.getTaskDependencyGraph(projectId, { includeCompleted });
      return response.data;
    },
    enabled: mode === 'project',
  });

  // Combine loading/error states
  const isLoading = mode === 'project' ? projectQuery.isLoading : taskQuery.isLoading;
  const error = mode === 'project' ? projectQuery.error : taskQuery.error;

  // Build graph based on mode - derived directly from query data (reactive)
  const { nodes, edges } = useMemo(() => {
    if (mode === 'project' && projectQuery.data) {
      return buildProjectGraph(projectQuery.data);
    }
    if (mode === 'task' && taskQuery.data) {
      return buildGraph(taskQuery.data, { includeCompleted });
    }
    return { nodes: [], edges: [] };
  }, [mode, projectQuery.data, taskQuery.data, includeCompleted]);

  // Compute topological order for keyboard navigation
  const topologicalOrder = useMemo(() => computeTopologicalOrder(nodes, edges), [nodes, edges]);

  // Mutations for modifying dependencies
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

  // Connect handler for creating new dependencies
  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) {
        addDependencyMutation.mutate({
          taskId: connection.target,
          dependsOnId: connection.source,
        });
      }
    },
    [addDependencyMutation],
  );

  // Remove dependency by edge ID
  const removeDependency = useCallback(
    (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        removeDependencyMutation.mutate({
          taskId: edge.target,
          dependsOnId: edge.source,
        });
      }
    },
    [edges, removeDependencyMutation],
  );

  // No-op handlers since we derive state from query data
  // Selection is handled by SelectionContext in the parent component
  const onNodesChange: OnNodesChange = useCallback(() => {
    // Nodes are derived from query data - changes come via React Query invalidation
  }, []);

  const onEdgesChange: OnEdgesChange = useCallback(() => {
    // Edges are derived from query data - changes come via React Query invalidation
  }, []);

  return {
    nodes,
    edges,
    topologicalOrder,
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

export { dependencyKeys, getStatusColor, computeTopologicalOrder, GRAPH_LAYOUT };
