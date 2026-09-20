'use client';

/**
 * `components/canvas/project-graph-panel` — the Project dependencies canvas.
 *
 * @remarks
 * An interactive host for the shared {@link "./canvas"#default | Canvas}: it projects the portfolio
 * overview rows onto xyflow {@link Node}s (rendered by {@link "./project-node"#default | ProjectNode})
 * and derives the dependency {@link Edge}s from each project's upstream blockers, then lets the
 * canvas's dagre pass lay everything out. When the viewer can `contribute`, dragging from one card's
 * handle to another creates a `blocking → blocked` dependency and selecting an edge + Delete removes
 * it — the server stays the cycle/duplicate authority and a surfaced notice explains a rejection.
 * The cards themselves never navigate on click (too easy to mis-fire while panning or wiring an
 * edge); each card carries its own explicit "open" affordance instead. React Flow is heavy, so
 * {@link "./project-graph-route"#ProjectGraphRoute | the route} lazy-loads this module.
 *
 * Three things this canvas shares with the rest of Projects rather than inventing for itself:
 *
 * - **The page's own frame.** It fills its page edge to edge under one floating bar that carries
 *   the title, the way back, the List and Dependencies switch, the counts, and the selection's
 *   actions; the inspector floats over the right edge and the canvas frames around both.
 * - **A meaning for selection.** Clicking a card opens {@link ProjectPeek} with the project's real
 *   properties and both directions of its dependencies. A selection that only draws a ring is the
 *   canvas telling you that you clicked.
 * - **A zoom that frames the work.** `fitView` alone will happily magnify a three-project
 *   workspace to twice life size, so the canvas is capped at 1:1 — fitting means fitting, never
 *   enlarging.
 */
import { type ProjectOverviewItem } from '../../lib/contracts/project';
import { EmptyState } from '@docket/ui/components';
import { FolderKanban } from '@docket/ui/icons';
import { type Edge, type Node, type ReactFlowInstance } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { type JSX, useCallback, useMemo, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import { BulkPropertiesDialogHost } from '@/components/canvas/bulk-actions-bar';
import CanvasCommandNotice from '@/components/canvas/canvas-command-notice';
import { CanvasCommandProviderWithHistory } from '@/components/canvas/canvas-command-context';
import { useCanvasFloatingChrome } from '@/components/canvas/canvas-floating-chrome';
import CanvasSelectionBridge from '@/components/canvas/canvas-selection-bridge';
import CanvasSelectionFrame from '@/components/canvas/canvas-selection-frame';
import { ProjectGraphBar } from '@/components/canvas/project-graph-bar';
import { useProjectGraphLayout } from '@/components/canvas/project-graph-layout';
import ProjectNode, { type ProjectNodeData } from '@/components/canvas/project-node';
import ProjectPeek from '@/components/canvas/project-peek';
import {
  useProjectGraphCommands,
  useProjectOverviewReceiptApplier,
  useProjectPeekModel,
} from '@/components/canvas/project-graph-panel-support';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';
import { api } from '@/lib/api';
import { fetchAllMembers, fetchAllRoles } from '@/lib/org-collection-pages';
import { useAppPathname } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import type { ObjectRef } from '@/lib/actions';
import { focusCanvasNode } from '@/components/canvas/focus-canvas-node';
import { projectRowsToPropertySnapshots } from '@/components/canvas/canvas-properties-model';
import { CanvasSelectionRetentionProvider } from '@/components/canvas/canvas-selection-retention';
import { useCanvasCommandHistory } from '@/components/canvas/use-canvas-command-history';
import CanvasOverlayPanel from '@/components/canvas/canvas-overlay-panel';
import { GraphInspectorHost } from '@/components/canvas/graph-inspector-host';

/** The registered node renderers for this canvas (only the project card). */
const NODE_TYPES = { project: ProjectNode };
const PROJECT_SELECTION_NODE_TYPES = ['project'] as const;

/** The minimap draws every project in the one quiet tone, so the graph's shape is what reads. */
function minimapNodeColor(): string {
  return 'var(--color-outline-variant)';
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
 * The Project dependencies canvas: an editable dependency graph over the portfolio rows, under one
 * floating bar.
 *
 * @param props - See {@link ProjectGraphPanelProps}.
 */
export function ProjectGraphPanel({ rows, orgId }: ProjectGraphPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const pathname = useAppPathname();
  const { openCreate } = useCreateObject();
  const { containerRef, aspectRatio, ready: aspectReady } = useCanvasAspectRatio();
  const floating = useCanvasFloatingChrome(true);
  const overviewKey = useMemo(() => [...queryKeys.projects(orgId), 'overview'] as const, [orgId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createdSelectionId, setCreatedSelectionId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const selectionSurfaceId = `project-graph:${orgId}`;
  const commandScopeKey = `project:${pathname}:all`;

  // The edit gate mirrors the task graph: only a `contribute`-capable viewer gets connectable
  // handles. Both lists are almost always already cached from the surrounding portfolio surfaces.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => fetchAllMembers(api, orgId),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => fetchAllRoles(api, orgId),
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
  // Every settled receipt (forward, undo, redo) patches the overview's dependency lists so the
  // canvas reflects it at once; the invalidation that follows confirms against the server.
  const patchOverview = useProjectOverviewReceiptApplier(queryClient, overviewKey);
  const history = useCanvasCommandHistory(
    orgId,
    commandScopeKey,
    [queryKeys.projects(orgId), overviewKey],
    patchOverview,
  );
  const { addDependency, removeDependency } = useProjectGraphCommands({
    rows,
    history,
    queryClient,
    overviewKey,
  });

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

  // The peek resolves from `rows`, the same array the canvas is drawn from, so an optimistic edge
  // shows up in both at once with no second request.
  const { selected, selectedLeadName, neighbors } = useProjectPeekModel(
    rows,
    selectedId,
    membersQ.data,
  );

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
    [openCreate, orgId, overviewKey, queryClient],
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
    },
    [flowInstance, selectionSurfaceId],
  );

  return (
    // The full-bleed page body owns the canvas edge; this panel fills its parent.
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
            presentation="floating"
            onOcclusionChange={floating.onInspectorOcclusion}
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
            <ProjectGraphBar
              orgId={orgId}
              counts={{ projects: rows.length, dependencies: edges.length }}
              onCreate={canEditDependencies ? createProject : undefined}
              insetRight={floating.inspectorRight}
              onHeightChange={floating.onHeightChange}
            />
            <Canvas
              nodes={positioned}
              edges={edges}
              nodeTypes={NODE_TYPES}
              interactive={canEditDependencies}
              density="full"
              disableLayout
              layoutReady={aspectReady}
              minimap
              nodeColor={minimapNodeColor}
              overlayInsets={floating.insets}
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
              <BulkPropertiesDialogHost />
              {rows.length === 0 ? (
                <CanvasOverlayPanel position="top-center" className="!top-1/2 !-translate-y-1/2">
                  <EmptyState
                    icon={FolderKanban}
                    title="No projects yet"
                    {...(canEditDependencies
                      ? {
                          cta: {
                            label: 'Create project',
                            onClick: () => {
                              createProject();
                            },
                          },
                        }
                      : {})}
                  />
                </CanvasOverlayPanel>
              ) : null}
            </Canvas>
          </GraphInspectorHost>
        </CanvasSelectionFrame>
      </CanvasCommandProviderWithHistory>
    </CanvasSelectionRetentionProvider>
  );
}
