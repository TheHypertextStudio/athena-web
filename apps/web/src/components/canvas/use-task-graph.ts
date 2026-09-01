'use client';

/**
 * `components/canvas/use-task-graph` — fetch a scoped task graph and map it to xyflow.
 *
 * @remarks
 * The single feeder behind every canvas embed. It reads the bulk graph endpoint for a scope
 * (org / project / task-neighborhood — the host decides), keyed so each scope caches apart,
 * and projects `GraphOut` into xyflow `nodes`/`edges`: hierarchy lives on each node's parent id,
 * while only scheduling dependencies become visible edges. It polls on a focus-gated
 * interval because edges change out-of-band when teammates add or remove `blocks` links.
 */
import type { GraphOut } from '@docket/work/task-model';
import { type Edge, MarkerType, type Node } from '@xyflow/react';
import { useMemo } from 'react';

import { unknownStatus, type WorkStatusDisplay } from '@/components/entity-display/work-status';
import { useStatusRegistry } from '@/components/statuses/status-registry';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useLiveApiQuery } from '@/lib/query';

import { annotateGraph, type EdgeTone } from './graph-annotate';
import { computeInsights } from './graph-insight';
import { type TaskGraphScope, taskGraphScopeKey } from './scope';
import type { ResolvedAssignee, TaskNodeData } from './task-node';
import type { CanvasDensity } from './use-dagre-layout';
import { userErrorMessage } from '@/lib/problem';

export type { TaskGraphScope } from './scope';

/** Resolve a task's assignee actor id to its display info, or null when unassigned/unknown. */
export type ResolveAssignee = (assigneeId: string | null) => ResolvedAssignee | null;

/** Resolve a project id to its display name, or null. */
export type ResolveProjectName = (projectId: string | null) => string | null;

/** Optional resolvers that enrich node cards with assignee + project names. */
export interface UseTaskGraphOptions {
  /** Maps an assignee actor id to its avatar/name (from the org's members/agents). */
  resolveAssignee?: ResolveAssignee | undefined;
  /** Maps a project id to its display name (from the org's projects). */
  resolveProjectName?: ResolveProjectName | undefined;
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
export function taskGraphToFlow(
  graph: GraphOut | undefined,
  orgId: string,
  density: CanvasDensity,
  rootTaskId: string | undefined,
  statusOf: (key: string) => WorkStatusDisplay,
  options: UseTaskGraphOptions,
): { nodes: Node[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  // The graph carries status *keys*; the category is resolved once, here, so the card, the
  // minimap, the peek, and the filter catalog all read one already-answered field.
  const statuses = new Map(graph.nodes.map((n) => [n.id, statusOf(n.state)]));
  const { nodeFlags, edgeTone } = annotateGraph({
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      stateType: statuses.get(n.id)?.category ?? 'backlog',
    })),
    edges: graph.edges,
  });
  // `graph.nodes`/`graph.edges` are structural supersets of what the pure analysis reads.
  const insights = computeInsights(graph.nodes, graph.edges);

  const nodes: Node[] = graph.nodes.map((n) => {
    const flags = nodeFlags.get(n.id) ?? { isBlocked: false, isReady: false };
    const status = statuses.get(n.id) ?? unknownStatus(n.state);
    return {
      id: n.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: {
        orgId,
        title: n.title,
        state: n.state,
        stateType: status.category,
        statusName: status.name,
        priority: n.priority,
        projectId: n.projectId ?? null,
        projectName: options.resolveProjectName?.(n.projectId ?? null) ?? null,
        programId: n.programId ?? null,
        labelIds: n.labelIds,
        teamId: n.teamId,
        milestoneId: n.milestoneId ?? null,
        cycleId: n.cycleId ?? null,
        parentTaskId: n.parentTaskId,
        assigneeId: n.assigneeId ?? null,
        assignee: options.resolveAssignee?.(n.assigneeId ?? null) ?? null,
        isBlocked: flags.isBlocked,
        isReady: flags.isReady,
        dueDate: n.dueDate ?? null,
        startDate: n.startDate ?? null,
        estimate: n.estimate ?? null,
        onCriticalPath: insights.criticalNodeIds.has(n.id),
        isBottleneck: insights.bottleneckIds.has(n.id),
        density,
        isRoot: n.id === rootTaskId,
      } satisfies TaskNodeData,
    };
  });

  const edges: Edge[] = graph.edges
    .filter((edge) => edge.kind === 'dependency')
    .map((e) => {
      const tone = edgeTone.get(e.id) ?? 'neutral';
      const critical = insights.criticalEdgeIds.has(e.id);
      // Critical-path edges read bold in the primary accent; others follow their blocker-completion tone.
      const stroke = critical ? 'var(--color-primary)' : TONE_STROKE[tone];
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        // Keep the stable kind on data for dependency delete/reconnect gating.
        data: { kind: e.kind },
        reconnectable: false,
        markerEnd: { type: MarkerType.ArrowClosed, ...(stroke ? { color: stroke } : {}) },
        style: {
          ...(stroke ? { stroke } : {}),
          ...(critical ? { strokeWidth: 2.5 } : {}),
        },
      };
    });

  return { nodes, edges };
}

/**
 * Read the task graph for `scope` and return xyflow-ready nodes/edges + status.
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
  const registry = useStatusRegistry();

  const query: Record<string, string> = {};
  if (projectId !== undefined) query['projectId'] = projectId;
  if (rootTaskId !== undefined) query['rootTaskId'] = rootTaskId;
  if (depth !== undefined) query['depth'] = String(depth);

  const q = useLiveApiQuery(
    apiQueryOptions(
      queryKeys.taskGraph(orgId, taskGraphScopeKey(scope)),
      () => api.v1.orgs[':orgId'].graph.$get({ param: { orgId }, query }),
      'Could not load the task graph.',
      { staleTime: STALE.volatile },
    ),
    REFRESH_MS,
  );

  const { nodes, edges } = useMemo(
    () =>
      taskGraphToFlow(
        q.data,
        orgId,
        density,
        rootTaskId,
        (key) => registry.statusOf('task', key) ?? unknownStatus(key),
        { resolveAssignee, resolveProjectName },
      ),
    [q.data, orgId, density, rootTaskId, registry, resolveAssignee, resolveProjectName],
  );

  return {
    nodes,
    edges,
    isLoading: q.isLoading,
    error: q.isError
      ? userErrorMessage(q.error, 'Could not load the task graph.') ||
        'Could not load the task graph.'
      : null,
    isEmpty: !q.isLoading && nodes.length === 0,
  };
}
