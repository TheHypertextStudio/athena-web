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
import { type ObjectCommandIn, type ProjectOverviewItem } from '@docket/types';
import { type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import BulkActionsBar from '@/components/canvas/bulk-actions-bar';
import CanvasCommandNotice from '@/components/canvas/canvas-command-notice';
import { CanvasCommandProviderWithHistory } from '@/components/canvas/canvas-command-context';
import CanvasSelectionBridge from '@/components/canvas/canvas-selection-bridge';
import CanvasSelectionFrame from '@/components/canvas/canvas-selection-frame';
import { useProjectGraphLayout } from '@/components/canvas/project-graph-layout';
import ProjectNode, { type ProjectNodeData } from '@/components/canvas/project-node';
import ProjectPeek, { type ProjectPeekNeighbor } from '@/components/canvas/project-peek';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';
import { api } from '@/lib/api';
import { useAppPathname } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import type { ObjectRef } from '@/lib/actions';
import { focusCanvasNode } from '@/components/canvas/focus-canvas-node';
import { projectRowsToPropertySnapshots } from '@/components/canvas/canvas-properties-model';
import { CanvasSelectionRetentionProvider } from '@/components/canvas/canvas-selection-retention';
import {
  canvasCommandId,
  useCanvasCommandHistory,
} from '@/components/canvas/use-canvas-command-history';
import CanvasOverlayPanel from '@/components/canvas/canvas-overlay-panel';
import { GraphInspectorHost } from '@/components/canvas/graph-inspector-host';

/** The registered node renderers for this canvas (only the project card). */
const NODE_TYPES = { project: ProjectNode };
const PROJECT_SELECTION_NODE_TYPES = ['project'] as const;

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
  /** A newly created Project to select once the refreshed overview includes it. */
  requestedSelectionId?: string | null | undefined;
  /** Clear the host's pending selection after the Project row becomes selectable. */
  onRequestedSelectionResolved?: ((id: string) => void) | undefined;
  /** Whether a post-create overview refresh has settled for the requested selection. */
  requestedSelectionSettled?: boolean | undefined;
  /** Preserve the created id in host-owned missing-row state when refresh excludes it. */
  onRequestedSelectionMissing?: ((id: string) => void) | undefined;
  /** Ask the retained work-view host to open Project creation. */
  onCreateProject?: ((returnFocusTo?: HTMLElement | null) => void) | undefined;
}

/**
 * The Projects Dependencies lens: an editable dependency canvas over the portfolio rows.
 *
 * @param props - See {@link ProjectGraphPanelProps}.
 */
export function ProjectGraphPanel({
  rows,
  orgId,
  requestedSelectionId = null,
  onRequestedSelectionResolved,
  requestedSelectionSettled = false,
  onRequestedSelectionMissing,
  onCreateProject,
}: ProjectGraphPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const pathname = useAppPathname();
  const { openCreate } = useCreateObject();
  const { containerRef, aspectRatio, ready: aspectReady } = useCanvasAspectRatio();
  const overviewKey = useMemo(() => [...queryKeys.projects(orgId), 'overview'] as const, [orgId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createdSelectionId, setCreatedSelectionId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const selectionSurfaceId = `project-graph:${orgId}`;
  const commandScopeKey = `project:${pathname}:all`;

  useEffect(() => {
    if (requestedSelectionId === null) return;
    if (rows.some((project) => project.id === requestedSelectionId)) {
      setSelectedId(requestedSelectionId);
      setCreatedSelectionId(requestedSelectionId);
      return;
    }
    if (requestedSelectionSettled) onRequestedSelectionMissing?.(requestedSelectionId);
  }, [
    onRequestedSelectionMissing,
    onRequestedSelectionResolved,
    requestedSelectionId,
    requestedSelectionSettled,
    rows,
  ]);

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
  const canEditDependencies = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );
  const canTrashProjects = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'manage',
  );
  const history = useCanvasCommandHistory(orgId, commandScopeKey, [
    queryKeys.projects(orgId),
    overviewKey,
  ]);
  const executeDependency = useCallback(
    (type: 'add_dependency' | 'remove_dependency', source: string, target: string) => {
      const command = {
        commandId: canvasCommandId(),
        objectKind: 'project',
        objectIds: [source, target],
        operation: { type, blockingId: source, blockedId: target },
      } as ObjectCommandIn;
      const blockingName = rows.find(({ id }) => id === source)?.name ?? 'Project';
      const blockedName = rows.find(({ id }) => id === target)?.name ?? 'Project';
      void history.execute(command, {
        historyLabel: type === 'add_dependency' ? 'Add dependency' : 'Remove dependency',
        title: type === 'add_dependency' ? 'Dependency added' : 'Dependency removed',
        detail:
          type === 'add_dependency'
            ? `${blockedName} depends on ${blockingName}`
            : `${blockedName} no longer depends on ${blockingName}`,
        unchangedTitle: 'Dependency unchanged',
        unchangedDetail:
          type === 'add_dependency'
            ? `${blockedName} already depends on ${blockingName}`
            : `${blockedName} did not depend on ${blockingName}`,
      });
    },
    [history, rows],
  );
  const addDependency = useCallback(
    (source: string, target: string) => {
      executeDependency('add_dependency', source, target);
    },
    [executeDependency],
  );
  const removeDependency = useCallback(
    (edge: Edge) => {
      executeDependency('remove_dependency', edge.source, edge.target);
    },
    [executeDependency],
  );

  const nodes = useMemo<Node[]>(() => {
    const rowIds = new Set(rows.map((item) => item.id));
    return rows.map((item) => {
      const waitingCount = item.blockedByIds.filter((upstreamId) => rowIds.has(upstreamId)).length;
      const data: ProjectNodeData = {
        name: item.name,
        orgId,
        status: item.status,
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
          status: row?.status ?? '',
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

  // The shared engine runs Dagre once per dependency component and then packs those measured
  // rectangles. Project cards remain fixed at their full-density dimensions.
  const positioned = useProjectGraphLayout(nodes, edges, aspectRatio, layoutEpoch).nodes;

  const selectionItems = useMemo<readonly ObjectRef[]>(
    () =>
      rows.map((item) => ({
        kind: 'project',
        id: item.id,
        organizationId: orgId,
        title: item.name,
        meta: { taskCount: item.taskCount },
      })),
    [orgId, rows],
  );
  const propertySnapshots = useMemo(
    () => projectRowsToPropertySnapshots(rows, orgId),
    [orgId, rows],
  );
  const createProject = useCallback(
    (returnFocusTo?: HTMLElement | null) => {
      if (onCreateProject !== undefined) {
        onCreateProject(returnFocusTo);
        return;
      }
      openCreate(
        {
          kind: 'project',
          initialWorkspaceId: orgId,
          sameWorkspaceCompletion: 'stay',
          onCreated: (created) => {
            setSelectedId(created.id);
            setCreatedSelectionId(created.id);
            void queryClient.invalidateQueries({ queryKey: overviewKey });
          },
        },
        returnFocusTo,
      );
    },
    [onCreateProject, openCreate, orgId, overviewKey, queryClient],
  );

  const applyCreatedSelection = useCallback(
    (node: Node) => {
      setSelectedId(node.id);
      void flowInstance?.fitView({
        nodes: [{ id: node.id }],
        duration: 300,
        maxZoom: 1,
        padding: 0.35,
      });
      focusCanvasNode(selectionSurfaceId, node.id);
      setCreatedSelectionId(null);
      if (node.id === requestedSelectionId) onRequestedSelectionResolved?.(node.id);
    },
    [flowInstance, onRequestedSelectionResolved, requestedSelectionId, selectionSurfaceId],
  );

  return (
    // The full-bleed page body owns the canvas edge. This panel fills its parent and no longer
    // cancels a document gutter with negative margins.
    <CanvasSelectionRetentionProvider
      scopeKey={commandScopeKey}
      items={selectionItems}
      propertySnapshots={propertySnapshots}
      surfaceId={selectionSurfaceId}
      organizationId={orgId}
    >
      <CanvasCommandProviderWithHistory
        objectKind="project"
        canEdit={canEditDependencies}
        canTrash={canTrashProjects}
        history={history}
        onCreateObject={createProject}
        onOpenObject={(object) => {
          setSelectedId(object.id);
        }}
      >
        <CanvasSelectionFrame label="Project dependency graph">
          {/* `containerRef` stays on this row, never on the canvas column — see the note in
              `GraphInspectorHost` about the aspect-ratio bucket re-packing the whole graph. */}
          <GraphInspectorHost
            hostRef={containerRef}
            className="size-full min-h-0 flex-1"
            aside={
              selected ? (
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
              ) : null
            }
            onClose={() => {
              setSelectedId(null);
            }}
          >
            <Canvas
              nodes={positioned}
              edges={edges}
              nodeTypes={NODE_TYPES}
              interactive={canEditDependencies}
              density="full"
              disableLayout
              layoutReady={aspectReady}
              minimap
              highlightChains={false}
              onSelectNode={setSelectedId}
              onConnectEdge={addDependency}
              onDeleteEdge={removeDependency}
              onInit={setFlowInstance}
              onRelayout={() => {
                setLayoutEpoch((current) => current + 1);
              }}
              bottomNotice={history.notice === null ? undefined : <CanvasCommandNotice />}
            >
              <CanvasSelectionBridge
                objectKind="project"
                nodeTypes={PROJECT_SELECTION_NODE_TYPES}
                requestedSelectionId={createdSelectionId}
                requestedSelectionReady={
                  createdSelectionId !== null &&
                  positioned.some(({ id }) => id === createdSelectionId)
                }
                onRequestedSelectionApplied={applyCreatedSelection}
              />
              <BulkActionsBar />
              {rows.length === 0 ? (
                <CanvasOverlayPanel position="top-center" className="!top-1/2 !-translate-y-1/2">
                  <p className="text-on-surface-variant text-body-medium rounded-lg px-5 py-3 text-center">
                    No matching Projects. Right-click the canvas to create one.
                  </p>
                </CanvasOverlayPanel>
              ) : null}
            </Canvas>
          </GraphInspectorHost>
        </CanvasSelectionFrame>
      </CanvasCommandProviderWithHistory>
    </CanvasSelectionRetentionProvider>
  );
}
