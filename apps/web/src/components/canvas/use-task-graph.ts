'use client';

/**
 * `components/canvas/use-task-graph` — fetch a scoped dependency graph and map it to xyflow.
 *
 * @remarks
 * The single feeder behind every canvas embed. It reads the bulk graph endpoint for a scope
 * (org / project / task-neighborhood — the host decides), keyed so each scope caches apart,
 * and projects `GraphOut` into xyflow `nodes`/`edges`: nodes get the `task` renderer; edges are
 * styled by kind (dependency = solid arrow, subtask = dashed). It polls on a focus-gated
 * interval because edges change out-of-band when teammates add or remove `blocks` links.
 */
import type { GraphOut } from '@docket/types';
import { type Edge, MarkerType, type Node } from '@xyflow/react';
import { useMemo } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useLiveApiQuery } from '@/lib/query';

import { type TaskGraphScope, taskGraphScopeKey } from './scope';
import type { TaskNodeData } from './task-node';
import type { CanvasDensity } from './use-dagre-layout';

export type { TaskGraphScope } from './scope';

/** The feeder result: xyflow inputs plus query status for the panel's states. */
export interface TaskGraphResult {
  /** Unpositioned xyflow nodes (the canvas lays them out). */
  nodes: Node[];
  /** Styled xyflow edges. */
  edges: Edge[];
  /** True on the first load (no data yet). */
  isLoading: boolean;
  /** A readable error message, or null. */
  error: string | null;
  /** True when the scope resolved to no viewable tasks. */
  isEmpty: boolean;
}

/** Edges refresh out-of-band; poll while focused so a teammate's new link shows up. */
const REFRESH_MS = 15_000;

/** Project the API payload into xyflow nodes/edges. */
function toFlow(
  graph: GraphOut | undefined,
  density: CanvasDensity,
  rootTaskId: string | undefined,
): { nodes: Node[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      title: n.title,
      state: n.state,
      density,
      isRoot: n.id === rootTaskId,
    } satisfies TaskNodeData,
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    ...(e.kind === 'subtask'
      ? { style: { strokeDasharray: '5 4', strokeOpacity: 0.7 } }
      : {}),
  }));
  return { nodes, edges };
}

/**
 * Read the dependency graph for `scope` and return xyflow-ready nodes/edges + status.
 *
 * @param scope - The graph scope (org by default; project or task-neighborhood when set).
 * @param density - The canvas density, baked into each node's data for sizing.
 * @returns the {@link TaskGraphResult}.
 */
export function useTaskGraph(scope: TaskGraphScope, density: CanvasDensity): TaskGraphResult {
  const { orgId, projectId, rootTaskId, depth } = scope;

  const query: Record<string, string> = {};
  if (projectId !== undefined) query['projectId'] = projectId;
  if (rootTaskId !== undefined) query['rootTaskId'] = rootTaskId;
  if (depth !== undefined) query['depth'] = String(depth);

  const q = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.taskGraph(orgId, taskGraphScopeKey(scope)),
      () => api.v1.orgs[':orgId'].graph.$get({ param: { orgId }, query }),
      'Could not load the dependency graph.',
      { staleTime: STALE.volatile },
    ),
    REFRESH_MS,
  );

  const { nodes, edges } = useMemo(
    () => toFlow(q.data, density, rootTaskId),
    [q.data, density, rootTaskId],
  );

  return {
    nodes,
    edges,
    isLoading: q.isLoading,
    error: q.isError ? (q.error.message || 'Could not load the dependency graph.') : null,
    isEmpty: !q.isLoading && nodes.length === 0,
  };
}
