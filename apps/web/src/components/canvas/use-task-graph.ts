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

import { annotateGraph, type EdgeTone } from './graph-annotate';
import { type TaskGraphScope, taskGraphScopeKey } from './scope';
import type { ResolvedAssignee, TaskNodeData } from './task-node';
import type { CanvasDensity } from './use-dagre-layout';

export type { TaskGraphScope } from './scope';

/** Resolve a task's assignee actor id to its display info, or null when unassigned/unknown. */
export type ResolveAssignee = (assigneeId: string | null) => ResolvedAssignee | null;

/** Resolve a project id to its display name, or null. */
export type ResolveProjectName = (projectId: string | null) => string | null;

/** Optional resolvers that enrich node cards with assignee + project names. */
export interface UseTaskGraphOptions {
  /** Maps an assignee actor id to its avatar/name (from the org's members/agents). */
  resolveAssignee?: ResolveAssignee;
  /** Maps a project id to its display name (from the org's projects). */
  resolveProjectName?: ResolveProjectName;
}

/** Dependency-edge stroke color per tone (CSS vars from the `--color-state-*` tokens). */
const TONE_STROKE: Record<EdgeTone, string | undefined> = {
  done: 'var(--color-state-completed)',
  open: 'var(--color-state-started)',
  neutral: undefined,
};

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

/** Project the API payload into xyflow nodes/edges, enriched with derived semantics. */
function toFlow(
  graph: GraphOut | undefined,
  density: CanvasDensity,
  rootTaskId: string | undefined,
  options: UseTaskGraphOptions,
): { nodes: Node[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  const { nodeFlags, edgeTone } = annotateGraph(graph);

  const nodes: Node[] = graph.nodes.map((n) => {
    const flags = nodeFlags.get(n.id) ?? { isBlocked: false, isReady: false };
    return {
      id: n.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: {
        title: n.title,
        state: n.state,
        priority: n.priority,
        projectId: n.projectId ?? null,
        projectName: options.resolveProjectName?.(n.projectId ?? null) ?? null,
        assigneeId: n.assigneeId ?? null,
        assignee: options.resolveAssignee?.(n.assigneeId ?? null) ?? null,
        isBlocked: flags.isBlocked,
        isReady: flags.isReady,
        density,
        isRoot: n.id === rootTaskId,
      } satisfies TaskNodeData,
    };
  });

  const edges: Edge[] = graph.edges.map((e) => {
    const tone = edgeTone.get(e.id) ?? 'neutral';
    const stroke = TONE_STROKE[tone];
    const isSubtask = e.kind === 'subtask';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      // The edge id encodes its kind (`dep:`/`sub:`); keep `kind` on data for delete-gating.
      data: { kind: e.kind },
      markerEnd: { type: MarkerType.ArrowClosed, ...(stroke ? { color: stroke } : {}) },
      style: {
        ...(stroke ? { stroke } : {}),
        ...(isSubtask ? { strokeDasharray: '5 4', strokeOpacity: 0.7 } : {}),
      },
    };
  });

  return { nodes, edges };
}

/**
 * Read the dependency graph for `scope` and return xyflow-ready nodes/edges + status.
 *
 * @param scope - The graph scope (org by default; project or task-neighborhood when set).
 * @param density - The canvas density, baked into each node's data for sizing.
 * @param options - Optional resolvers enriching node cards (assignee avatar, project name).
 * @returns the {@link TaskGraphResult}.
 */
export function useTaskGraph(
  scope: TaskGraphScope,
  density: CanvasDensity,
  options: UseTaskGraphOptions = {},
): TaskGraphResult {
  const { orgId, projectId, rootTaskId, depth } = scope;
  const { resolveAssignee, resolveProjectName } = options;

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
    () => toFlow(q.data, density, rootTaskId, { resolveAssignee, resolveProjectName }),
    [q.data, density, rootTaskId, resolveAssignee, resolveProjectName],
  );

  return {
    nodes,
    edges,
    isLoading: q.isLoading,
    error: q.isError ? q.error.message || 'Could not load the dependency graph.' : null,
    isEmpty: !q.isLoading && nodes.length === 0,
  };
}
