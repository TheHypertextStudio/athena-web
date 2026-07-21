'use client';

/**
 * `components/canvas/project-graph-panel` — the Projects "Dependencies" lens.
 *
 * @remarks
 * An interactive host for the shared {@link "./canvas"#default | Canvas}: it projects the portfolio
 * overview rows onto xyflow {@link Node}s (rendered by {@link "./project-node"#default | ProjectNode})
 * and derives the dependency {@link Edge}s from each project's upstream blockers, then lets the
 * canvas's dagre pass lay everything out. When the viewer can `contribute`, dragging from one card's
 * handle to another creates a `blocking → blocked` dependency and selecting an edge + Delete removes
 * it — the server stays the cycle/duplicate authority and a surfaced notice explains a rejection.
 * The cards themselves never navigate on click (too easy to mis-fire while panning or wiring an
 * edge); each card carries its own explicit "open" affordance instead. React Flow is heavy, so the
 * Projects list lazy-loads this module only when the Dependencies lens is opened.
 */
import {
  ProjectId,
  type Health,
  type ProjectDependencyCreated,
  type ProjectDependencyRemoved,
  type ProjectOverviewItem,
  type ProjectOverviewOut,
  type ProjectStatus,
} from '@docket/types';
import { X } from '@docket/ui/icons';
import { type Edge, type Node, Panel } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useMemo } from 'react';

import Canvas from '@/components/canvas/canvas';
import ProjectNode, { type ProjectNodeData, projectData } from '@/components/canvas/project-node';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiListQuery, useApiMutation } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

/** The registered node renderers for this canvas (only the project card). */
const NODE_TYPES = { project: ProjectNode };

/** Minimap/node accent color by health verdict (the canvas is generic; the host injects this). */
function projectHealthColor(node: Node): string {
  const { health } = projectData(node);
  const token: Record<Health, string> = {
    on_track: 'var(--color-state-completed)',
    at_risk: 'var(--color-state-canceled)',
    off_track: 'var(--color-destructive)',
  };
  return health === null ? 'var(--color-outline-variant)' : token[health];
}

/** Weighted completion (0–100) from a row's task counts. */
function progressPercent(item: ProjectOverviewItem): number {
  return item.taskCount === 0 ? 0 : Math.round((item.completedTaskCount / item.taskCount) * 100);
}

/** Props for {@link ProjectGraphPanel}. */
export interface ProjectGraphPanelProps {
  /** The (already filtered) portfolio rows to graph. */
  rows: readonly ProjectOverviewItem[];
  /** The owning org id, used to build project navigation hrefs and scope dependency writes. */
  orgId: string;
}

/**
 * The Projects Dependencies lens: an editable dependency canvas over the portfolio rows.
 *
 * @param props - See {@link ProjectGraphPanelProps}.
 */
export function ProjectGraphPanel({ rows, orgId }: ProjectGraphPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const overviewKey = useMemo(() => [...queryKeys.projects(orgId), 'overview'] as const, [orgId]);

  // The edit gate mirrors the task graph: only a `contribute`-capable viewer gets connectable
  // handles. Both lists are almost always already cached from the surrounding portfolio surfaces.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const canEdit = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );

  // Optimistically rewrite the target's blocker set (and the source's blocks set) so a dragged or
  // removed edge shows immediately; the overview refetch then reconciles with the server truth.
  const writeEdge = useCallback(
    (source: string, target: string, present: boolean): ProjectOverviewOut | undefined => {
      // The graph hands back raw string ids; the overview rows carry branded ProjectIds.
      const src = ProjectId.parse(source);
      const tgt = ProjectId.parse(target);
      const previous = queryClient.getQueryData<ProjectOverviewOut>(overviewKey);
      queryClient.setQueryData<ProjectOverviewOut>(overviewKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => {
                if (item.id === tgt) {
                  const set = new Set(item.blockedByIds);
                  if (present) set.add(src);
                  else set.delete(src);
                  return { ...item, blockedByIds: [...set].sort() };
                }
                if (item.id === src) {
                  const set = new Set(item.blocksIds);
                  if (present) set.add(tgt);
                  else set.delete(tgt);
                  return { ...item, blocksIds: [...set].sort() };
                }
                return item;
              }),
            }
          : current,
      );
      return previous;
    },
    [queryClient, overviewKey],
  );

  const connectMutation = useApiMutation<
    ProjectDependencyCreated,
    { source: string; target: string },
    { previous?: ProjectOverviewOut }
  >({
    mutationFn: ({ source, target }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].dependencies.$post({
            param: { orgId, id: source },
            json: { blockedProjectId: target },
          }),
        'Could not link these projects.',
      ),
    onMutate: async ({ source, target }) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      return { previous: writeEdge(source, target, true) };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(overviewKey, ctx.previous);
    },
    invalidateKeys: [overviewKey],
  });

  const disconnectMutation = useApiMutation<
    ProjectDependencyRemoved,
    { source: string; target: string },
    { previous?: ProjectOverviewOut }
  >({
    mutationFn: ({ source, target }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].projects[':id'].dependencies[':depId'].$delete({
            param: { orgId, id: source, depId: target },
          }),
        'Could not remove this link.',
      ),
    onMutate: async ({ source, target }) => {
      await queryClient.cancelQueries({ queryKey: overviewKey });
      return { previous: writeEdge(source, target, false) };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(overviewKey, ctx.previous);
    },
    invalidateKeys: [overviewKey],
  });

  const addDependency = useCallback(
    (source: string, target: string) => {
      connectMutation.mutate({ source, target });
    },
    [connectMutation],
  );
  const removeDependency = useCallback(
    (edge: Edge) => {
      disconnectMutation.mutate({ source: edge.source, target: edge.target });
    },
    [disconnectMutation],
  );

  const mutationError = connectMutation.error
    ? userErrorMessage(connectMutation.error, 'Could not link these projects.')
    : disconnectMutation.error
      ? userErrorMessage(disconnectMutation.error, 'Could not remove this link.')
      : null;
  const clearError = useCallback(() => {
    connectMutation.reset();
    disconnectMutation.reset();
  }, [connectMutation, disconnectMutation]);

  const nodes = useMemo<Node[]>(() => {
    const rowIds = new Set(rows.map((item) => item.id));
    return rows.map((item) => {
      const waitingCount = item.blockedByIds.filter((upstreamId) => rowIds.has(upstreamId)).length;
      const data: ProjectNodeData = {
        name: item.name,
        orgId,
        status: item.status as ProjectStatus,
        health: item.health ?? null,
        progress: progressPercent(item),
        targetDate: item.targetDate ?? null,
        waitingCount,
        density: 'full',
      };
      return { id: item.id, type: 'project', position: { x: 0, y: 0 }, data };
    });
  }, [rows, orgId]);

  const edges = useMemo<Edge[]>(() => {
    const rowIds = new Set(rows.map((item) => item.id));
    return rows.flatMap((item) =>
      item.blockedByIds
        .filter((upstreamId) => rowIds.has(upstreamId))
        .map((upstreamId) => ({
          id: `${upstreamId}->${item.id}`,
          source: upstreamId,
          target: item.id,
        })),
    );
  }, [rows]);

  if (rows.length === 0)
    return <p className="text-on-surface-variant p-8 text-center text-sm">No matching projects.</p>;

  return (
    <div className="h-[560px] w-full">
      <Canvas
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        interactive={canEdit}
        density="full"
        nodeColor={projectHealthColor}
        // Hovering a card should not fade the rest of the portfolio; the chain-dimming is for dense
        // task graphs, not a handful of projects.
        highlightChains={false}
        onConnectEdge={addDependency}
        onDeleteEdge={removeDependency}
      >
        {mutationError !== null ? (
          <Panel position="bottom-center">
            <div className="border-state-canceled/40 bg-surface-container text-state-canceled text-body-medium flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-lg">
              {mutationError}
              <button type="button" onClick={clearError} aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </div>
          </Panel>
        ) : null}
      </Canvas>
    </div>
  );
}
