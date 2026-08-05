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
 *
 * Three things this lens now shares with the rest of Projects rather than inventing for itself:
 *
 * - **The page's own frame.** It fills the content panel exactly as the list lens does, instead of
 *   being a 560px-tall widget parked inside it with a strip of dead page underneath.
 * - **A meaning for selection.** Clicking a card opens {@link ProjectPeek} with the project's real
 *   properties and both directions of its dependencies. A selection that only draws a ring is the
 *   canvas telling you that you clicked.
 * - **A zoom that frames the work.** `fitView` alone will happily magnify a three-project
 *   workspace to twice life size, so the canvas is capped at 1:1 — fitting means fitting, never
 *   enlarging.
 */
import {
  ProjectId,
  type ProjectDependencyCreated,
  type ProjectDependencyRemoved,
  type ProjectOverviewItem,
  type ProjectOverviewOut,
  type ProjectStatus,
} from '@docket/types';
import { X } from '@docket/ui/icons';
import { type Edge, type Node, Panel } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useMemo, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import { packIsolatedNodes } from '@/components/canvas/pack-isolated';
import ProjectNode, { type ProjectNodeData } from '@/components/canvas/project-node';
import ProjectPeek, { type ProjectPeekNeighbor } from '@/components/canvas/project-peek';
import { NODE_SIZE, useDagreLayout } from '@/components/canvas/use-dagre-layout';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiListQuery, useApiMutation } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';

/** The registered node renderers for this canvas (only the project card). */
const NODE_TYPES = { project: ProjectNode };

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        taskCount: item.taskCount,
        completedTaskCount: item.completedTaskCount,
        targetDate: item.targetDate ?? null,
        waitingCount,
        density: 'full',
      };
      return { id: item.id, type: 'project', position: { x: 0, y: 0 }, data };
    });
  }, [rows, orgId]);

  /**
   * The selected row, and the two directions of its dependencies.
   *
   * @remarks
   * Resolved from `rows` — the same array the canvas is drawn from — so the panel can never
   * disagree with the graph, and an optimistic edge write shows up in both at once with no second
   * request. A neighbour that the current filter has excluded is still listed (a blocker you
   * cannot see is the one that hurts) but is marked as off-canvas, because there is no node for
   * the selection to move to.
   */
  const selected = useMemo(
    () => rows.find((item) => item.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedLeadName = useMemo(() => {
    if (!selected?.leadId) return null;
    return (
      membersQ.data?.items.find((member) => member.actorId === selected.leadId)?.displayName ?? null
    );
  }, [membersQ.data, selected]);
  const neighbors = useMemo(() => {
    const empty: readonly ProjectPeekNeighbor[] = [];
    if (!selected) return { blockedBy: empty, blocks: empty };
    const onCanvas = new Set(rows.map((item) => item.id));
    const byId = new Map(rows.map((item) => [item.id, item] as const));
    const resolve = (ids: readonly string[]): readonly ProjectPeekNeighbor[] =>
      ids.map((id) => {
        const row = byId.get(id as (typeof rows)[number]['id']);
        return {
          id,
          name: row?.name ?? 'Filtered out',
          status: (row?.status ?? 'planned') as ProjectStatus,
          onCanvas: onCanvas.has(id as (typeof rows)[number]['id']),
        };
      });
    return {
      blockedBy: resolve(selected.blockedByIds),
      blocks: resolve(selected.blocksIds),
    };
  }, [rows, selected]);

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

  /**
   * The final node positions: dagre over the chains, a packed block for everything else.
   *
   * @remarks
   * Most projects in a real portfolio depend on nothing, and a layered layout has no opinion about
   * a node with no edges — dagre stacks every one of them in a single rank-0 column. That column
   * then dominates the canvas's height and drags `fitView` down until the chains, the only thing
   * this lens is for, are illegible. Laying out the connected subgraph on its own and packing the
   * rest into a block underneath keeps the fitted graph close to the viewport's own proportions.
   */
  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return ids;
  }, [edges]);
  const connected = useMemo(
    () => nodes.filter((node) => connectedIds.has(node.id)),
    [nodes, connectedIds],
  );
  const isolated = useMemo(
    () => nodes.filter((node) => !connectedIds.has(node.id)),
    [nodes, connectedIds],
  );
  const laidOutConnected = useDagreLayout(connected, edges, 'full');
  const positioned = useMemo(
    () => packIsolatedNodes(laidOutConnected, isolated, NODE_SIZE.full),
    [laidOutConnected, isolated],
  );

  if (rows.length === 0)
    return (
      <p className="text-on-surface-variant text-body-medium p-8 text-center">
        No matching projects.
      </p>
    );

  return (
    // Fills the content panel and runs to its bottom edge. The page container's closing gutter is
    // cancelled because a scrolling list does not show it either — its rows are simply clipped by
    // the panel — so leaving it in place is what made this lens sit 24px shorter than the list it
    // is meant to match pixel for pixel.
    <div className="-mb-4 min-h-0 w-full flex-1 @2xl:-mb-6 @4xl:-mb-8">
      <Canvas
        nodes={positioned}
        edges={edges}
        nodeTypes={NODE_TYPES}
        interactive={canEdit}
        density="full"
        // Positions are computed above (dagre over the chains + a packed block for the rest), so
        // the canvas must not re-run its own pass over the combined set.
        disableLayout
        // A portfolio holds a few dozen wide cards, all of which fit; the minimap would be an
        // abstracted grey block of them parked over the canvas, which is what the launch review
        // photographed.
        minimap={false}
        // Hovering a card should not fade the rest of the portfolio; the chain-dimming is for dense
        // task graphs, not a handful of projects.
        highlightChains={false}
        onSelectNode={setSelectedId}
        onConnectEdge={addDependency}
        onDeleteEdge={removeDependency}
      >
        {selected ? (
          <Panel position="top-right">
            <ProjectPeek
              project={selected}
              orgId={orgId}
              leadName={selectedLeadName}
              blockedBy={neighbors.blockedBy}
              blocks={neighbors.blocks}
              onSelect={setSelectedId}
              onClose={() => {
                setSelectedId(null);
              }}
            />
          </Panel>
        ) : null}
        {mutationError !== null ? (
          <Panel position="bottom-center">
            <div className="bg-error-container text-on-error-container text-body-medium flex items-center gap-2 rounded-lg px-3 py-1.5">
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
