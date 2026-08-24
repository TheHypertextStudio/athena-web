'use client';

/**
 * `components/canvas/task-graph-panel` — the task-graph host every surface renders.
 *
 * @remarks
 * Feeds {@link useTaskGraph} for a scope into the generic {@link Canvas} and owns everything
 * task-specific: resolving assignee avatars + project names (from the org's members/agents/
 * projects), the `contribute` edit gate, the live-edit mutations (drag to add a `blocks` edge,
 * click an edge's remove control or press Delete to drop one, quick state change), the selection
 * peek, and — when the host supplies `renderChrome` — the shared view bar. Loading / empty / error
 * states are handled here so hosts stay declarative. Embeds use the compact density (click
 * navigates); the focused view passes `renderChrome` + full density (click peeks, double-click
 * navigates).
 *
 * Filtering and grouping run through the app's shared view engine
 * ({@link import('./graph-catalog').buildGraphCatalog} + `filterRows`) rather than the bespoke
 * facet bar this panel used to carry, so the canvas has the same Filter/Display vocabulary as
 * every list surface. Canvas-only presentation (flow direction, overlays, neighbourhood depth)
 * lives in {@link import('./graph-display').GraphDisplayState} beside it.
 */
import type { ObjectCommandIn } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Workflow, X } from '@docket/ui/icons';
import { Button, Skeleton, Surface } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type Edge, type Node, Panel, type ReactFlowInstance } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useCallback, useMemo, useState } from 'react';

import { useStatusRegistry } from '@/components/statuses/status-registry';
import { api } from '@/lib/api';
import { useAppPathname } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import {
  type FieldOption,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewState,
  EMPTY_VIEW_STATE,
  findField,
  labelForValue,
  RESOLVING_LABEL,
} from '@/components/views/field-catalog';
import { filterRows } from '@/components/views/apply-view';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import type { ObjectRef } from '@/lib/actions';
import { taskNodesToPropertySnapshots } from '@/components/canvas/canvas-properties-model';
import { CanvasSelectionRetentionProvider } from '@/components/canvas/canvas-selection-retention';

import BulkActionsBar from './bulk-actions-bar';
import Canvas from './canvas';
import CanvasCommandNotice from './canvas-command-notice';
import { CanvasCommandProviderWithHistory } from './canvas-command-context';
import CanvasCreatedHiddenNotice from './canvas-created-hidden-notice';
import CanvasSelectionBridge from './canvas-selection-bridge';
import CanvasSelectionFrame from './canvas-selection-frame';
import { type CanvasActions, CanvasActionsProvider } from './canvas-actions-context';
import DependencyEdge from './dependency-edge';
import { DEFAULT_GRAPH_DISPLAY, type GraphDisplayState } from './graph-display';
import { buildGraphCatalog, UNSET } from './graph-catalog';
import GraphViewBar from './graph-view-bar';
import GroupNode from './group-node';
import { edgeKind } from './use-graph-interactions';
import { type GroupSpec } from './use-grouped-layout';
import NodePeek from './node-peek';
import TaskNode, { type ResolvedAssignee, taskData } from './task-node';
import TaskBranchNode from './task-branch-node';
import { retainTaskHierarchyAncestors, useTaskHierarchyLayout } from './task-hierarchy-layout';
import { type CanvasDensity } from './use-dagre-layout';
import { useCanvasAspectRatio } from './use-canvas-aspect-ratio';
import { type TaskGraphScope, useTaskGraph } from './use-task-graph';
import { taskGraphScopeKey } from './scope';
import { useTaskGraphCreation } from './use-task-graph-creation';
import { focusCanvasNode } from './focus-canvas-node';
import { canvasCommandId, useCanvasCommandHistory } from './use-canvas-command-history';

/** Stable registries (must not be re-created per render — xyflow warns otherwise). */
const NODE_TYPES = { task: TaskNode, taskBranch: TaskBranchNode, group: GroupNode };
const EDGE_TYPES = { default: DependencyEdge };

/** Props for {@link TaskGraphPanel}. */
export interface TaskGraphPanelProps {
  /** The scope to render (org / project / task-neighborhood). */
  scope: TaskGraphScope;
  /** Canvas density; default `compact` since the common host is an embed. */
  density?: CanvasDensity;
  /**
   * Render the page chrome around the view bar (focused view only); omit for a bare embed.
   *
   * @remarks
   * Takes the bar as an argument rather than a boolean flag so the host owns the band it lives in
   * — an {@link AppBar} with the page title on the focused view, something else in a future host —
   * while this panel keeps ownership of the bar's wiring. A panel that renders its own header
   * would force every host into the same masthead.
   */
  renderChrome?: (bar: React.ReactNode) => React.ReactNode;
  /** Controlled query state (URL-backed); falls back to internal state when omitted. */
  viewState?: ViewState;
  /** Replace the active filter predicates; paired with `viewState`. */
  onFiltersChange?: (filters: readonly ViewFilterTerm[]) => void;
  /** Replace the active grouping; paired with `viewState`. */
  onGroupByChange?: (groupBy: ViewGroupTerm | null) => void;
  /** Controlled canvas presentation; falls back to internal state when omitted. */
  display?: GraphDisplayState;
  /** Patch the canvas presentation; paired with `display`. */
  onDisplayChange?: (patch: Partial<GraphDisplayState>) => void;
  /** When set, shows an expand affordance that calls this (e.g. navigate to the full view). */
  onExpand?: () => void;
  /** Extra classes for the container. */
  className?: string;
}

/** Minimap node color by status-category token (the canvas is generic; the host injects this). */
function taskStateColor(node: Node): string {
  if (node.type === 'group') return 'var(--color-surface-container-low)';
  return `var(--color-state-${taskData(node).stateType})`;
}

/** Keep only edges whose endpoints both survived filtering. */
function pruneEdges(nodes: readonly Node[], edges: readonly Edge[]): Edge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

/** A scoped, interactive dependency-graph canvas with peek, editing, and optional view bar. */
export default function TaskGraphPanel({
  scope,
  density = 'compact',
  renderChrome,
  viewState: controlledViewState,
  onFiltersChange,
  onGroupByChange,
  display: controlledDisplay,
  onDisplayChange,
  onExpand,
  className,
}: TaskGraphPanelProps): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useAppPathname();
  const { openCreate } = useCreateObject();
  const { containerRef, aspectRatio, ready: aspectReady } = useCanvasAspectRatio();
  const { orgId } = scope;

  // Org reference data for avatars, project chips, the edit gate, and filter options.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const agentsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.agents(orgId),
      () => api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      'Could not load agents.',
    ),
  );
  const projectsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load teams.',
    ),
  );
  const milestonesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.milestones(orgId),
      () => api.v1.orgs[':orgId'].milestones.$get({ param: { orgId }, query: {} }),
      'Could not load milestones.',
    ),
  );

  const members = membersQ.data?.items;
  const agents = agentsQ.data?.items;
  const projects = projectsQ.data?.items;
  const roles = rolesQ.data?.items;
  const teams = teamsQ.data?.items;
  const milestones = milestonesQ.data?.items;

  const canEdit = useOrgCapability(members ?? [], roles ?? [], 'contribute');

  const resolveAssignee = useCallback(
    (assigneeId: string | null): ResolvedAssignee | null => {
      if (assigneeId === null) return null;
      const m = members?.find((x) => x.actorId === assigneeId);
      if (m) return { name: m.displayName, kind: 'human', avatarUrl: m.avatar ?? null };
      if (agents?.some((x) => x.actorId === assigneeId)) return { name: 'Agent', kind: 'agent' };
      // `members`/`agents` are `undefined` while their queries are still pending, so this branch
      // fires both mid-load and for a genuinely-unresolvable assignee — tell them apart rather
      // than always showing the id-derived fallback.
      if (membersQ.isPending || agentsQ.isPending) return { name: RESOLVING_LABEL, kind: 'human' };
      return { name: `Member ${assigneeId.slice(0, 6)}`, kind: 'human' };
    },
    [members, agents, membersQ.isPending, agentsQ.isPending],
  );
  const resolveProjectName = useCallback(
    (projectId: string | null): string | null => {
      if (projectId === null) return null;
      return projects?.find((p) => p.id === projectId)?.name ?? null;
    },
    [projects],
  );

  // Query + presentation are controlled when the host supplies them (URL-backed full view),
  // else held locally so an embed still works standalone.
  const [localViewState, setLocalViewState] = useState<ViewState>(EMPTY_VIEW_STATE);
  const [localDisplay, setLocalDisplay] = useState<GraphDisplayState>(DEFAULT_GRAPH_DISPLAY);
  const viewState = controlledViewState ?? localViewState;
  const display = controlledDisplay ?? localDisplay;

  const setFilters = useCallback(
    (filters: readonly ViewFilterTerm[]) => {
      if (onFiltersChange) onFiltersChange(filters);
      else setLocalViewState((prev) => ({ ...prev, filters }));
    },
    [onFiltersChange],
  );
  const setGroupBy = useCallback(
    (groupBy: ViewGroupTerm | null) => {
      if (onGroupByChange) onGroupByChange(groupBy);
      else setLocalViewState((prev) => ({ ...prev, groupBy }));
    },
    [onGroupByChange],
  );
  const patchDisplay = useCallback(
    (patch: Partial<GraphDisplayState>) => {
      if (onDisplayChange) onDisplayChange(patch);
      else setLocalDisplay((prev) => ({ ...prev, ...patch }));
    },
    [onDisplayChange],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createdSelectionId, setCreatedSelectionId] = useState<string | null>(null);
  const [settledCreatedSelectionId, setSettledCreatedSelectionId] = useState<string | null>(null);
  const [createdOutsideScopeId, setCreatedOutsideScopeId] = useState<string | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  // In the neighborhood scope, the depth control overrides the incoming scope depth live.
  const isNeighborhood = scope.rootTaskId !== undefined;
  const depth = display.depth ?? scope.depth ?? 2;
  const effectiveScope = useMemo(
    () => (isNeighborhood ? { ...scope, depth } : scope),
    [isNeighborhood, scope, depth],
  );
  const selectionSurfaceId = `task-graph:${orgId}:${taskGraphScopeKey(effectiveScope)}`;
  const commandScopeKey = `task:${pathname}:${taskGraphScopeKey(effectiveScope)}`;

  const { nodes, edges, isLoading, error, isEmpty } = useTaskGraph(effectiveScope, density, {
    resolveAssignee,
    resolveProjectName,
  });
  const creation = useTaskGraphCreation(effectiveScope);
  const graphKey = useMemo(
    () => queryKeys.taskGraph(orgId, taskGraphScopeKey(effectiveScope)),
    [effectiveScope, orgId],
  );
  const history = useCanvasCommandHistory(orgId, commandScopeKey, [
    graphKey,
    queryKeys.tasks(orgId),
  ]);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  const toOptions = useCallback(
    (items: readonly { id: string; name: string }[] | undefined): readonly FieldOption[] =>
      (items ?? []).map((item) => ({ value: item.id, label: item.name })),
    [],
  );

  // "Mark done" / "Reopen" name outcomes, so the workspace's own completed and starting statuses
  // are resolved once here rather than spelled as literal keys by every element that offers them.
  const statuses = useStatusRegistry();
  const setComplete = useCallback(
    (id: string, complete: boolean) => {
      const target = complete
        ? statuses.firstOfCategory('task', 'completed')
        : statuses.defaultOf('task');
      if (target === undefined) return;
      const command = {
        commandId: canvasCommandId(),
        objectKind: 'task',
        objectIds: [id],
        operation: { type: 'replace_property', property: 'state', value: target.key },
      } as ObjectCommandIn;
      void history.execute(command, complete ? 'Mark Task done' : 'Reopen Task');
    },
    [history, statuses],
  );

  const executeDependency = useCallback(
    async (
      type: 'add_dependency' | 'remove_dependency',
      blockingId: string,
      blockedId: string,
      label: string,
    ) => {
      const command = {
        commandId: canvasCommandId(),
        objectKind: 'task',
        objectIds: [blockingId, blockedId],
        operation: { type, blockingId, blockedId },
      } as ObjectCommandIn;
      return history.execute(command, label);
    },
    [history],
  );
  const addDependency = useCallback(
    (blockingId: string, blockedId: string) => {
      void executeDependency('add_dependency', blockingId, blockedId, 'Add dependency');
    },
    [executeDependency],
  );
  const removeDependency = useCallback(
    (blockingId: string, blockedId: string) => {
      void executeDependency('remove_dependency', blockingId, blockedId, 'Remove dependency');
    },
    [executeDependency],
  );
  const catalog = useMemo(
    () =>
      buildGraphCatalog({
        projectLabel: 'Project',
        projectOptions: toOptions(projects),
        assigneeOptions: (members ?? []).map((m) => ({ value: m.actorId, label: m.displayName })),
        teamOptions: toOptions(teams),
        milestoneOptions: toOptions(milestones),
      }),
    [toOptions, projects, members, teams, milestones],
  );

  // Search is applied alongside the predicates: it narrows the node set *and* drives the viewport
  // fit below, which is why it is presentation state rather than another filter chip.
  const needle = display.search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (renderChrome === undefined) return { nodes, edges };
    const byPredicate = filterRows(nodes, viewState.filters, catalog);
    const bySearch =
      needle.length === 0
        ? byPredicate
        : byPredicate.filter((n) => taskData(n).title.toLowerCase().includes(needle));
    const keptNodes = retainTaskHierarchyAncestors(
      nodes,
      bySearch.map(({ id }) => id),
    );
    return { nodes: keptNodes, edges: pruneEdges(keptNodes, edges) };
  }, [renderChrome, nodes, edges, viewState.filters, catalog, needle]);

  const navigate = useCallback(
    (id: string) => {
      router.push(`/orgs/${orgId}/tasks/${id}`);
    },
    [router, orgId],
  );

  // Compact embeds navigate on click; the full view peeks (double-click navigates).
  const handleSelect = useCallback(
    (id: string | null) => {
      if (id === null) {
        setSelectedId(null);
        return;
      }
      if (density === 'full') setSelectedId(id);
      else navigate(id);
    },
    [density, navigate],
  );

  // One pass over the filtered nodes derives the critical set, ready queue, and blocked count.
  const derived = useMemo(() => {
    const criticalIds = new Set<string>();
    const readyNodes: Node[] = [];
    let blocked = 0;
    for (const n of filtered.nodes) {
      const d = taskData(n);
      if (d.onCriticalPath) criticalIds.add(n.id);
      if (d.isReady) readyNodes.push(n);
      if (d.isBlocked) blocked += 1;
    }
    const deps = filtered.edges.filter((e) => edgeKind(e) === 'dependency').length;
    return {
      criticalIds,
      readyNodes,
      counts: { tasks: filtered.nodes.length, deps, blocked, ready: readyNodes.length },
    };
  }, [filtered]);
  const { criticalIds, readyNodes, counts } = derived;

  // With an active search, pan/zoom the canvas to the (already-filtered) matches.
  const focusOn = useMemo(
    () => (needle.length > 0 ? filtered.nodes.map((n) => n.id) : undefined),
    [needle, filtered.nodes],
  );

  const selectedNode = useMemo(
    () => (selectedId === null ? null : (filtered.nodes.find((n) => n.id === selectedId) ?? null)),
    [selectedId, filtered.nodes],
  );

  // Element-level actions for the node toolbar and the edge's remove control.
  const canvasActions = useMemo<CanvasActions>(
    () => ({
      canEdit,
      navigate,
      setComplete,
      createSubtask: creation.createSubtask,
      removeDependency,
    }),
    [canEdit, navigate, setComplete, creation.createSubtask, removeDependency],
  );

  // Grouping reads straight off the catalog, so every groupable field the catalog declares works
  // as a swimlane axis without this panel knowing which fields those are.
  const groupSpec = useMemo<GroupSpec | null>(() => {
    if (viewState.groupBy === null) return null;
    const field = findField(catalog, viewState.groupBy.field);
    if (field === undefined) return null;
    return {
      groupOf: (n) => {
        const value = field.accessor(n);
        return value === null || value === UNSET ? null : String(value);
      },
      labelOf: (id) => labelForValue(field, id),
    };
  }, [viewState.groupBy, catalog]);

  // Hierarchy is always a pre-positioned compound layout; optional grouping wraps whole roots.
  const canvasNodes = useTaskHierarchyLayout(
    filtered.nodes,
    filtered.edges,
    density,
    display.direction,
    groupSpec,
    aspectRatio,
    layoutEpoch,
  );

  const selectionItems = useMemo<readonly ObjectRef[]>(
    () =>
      filtered.nodes.map((node) => {
        const data = taskData(node);
        return {
          kind: 'task',
          id: node.id,
          title: data.title,
          organizationId: orgId,
          meta: { state: data.state, parentTaskId: data.parentTaskId },
        };
      }),
    [filtered.nodes, orgId],
  );
  const propertySnapshots = useMemo(
    () => taskNodesToPropertySnapshots(filtered.nodes, orgId),
    [filtered.nodes, orgId],
  );
  const reparentTask = useCallback(
    (taskId: string, parentTaskId: string) => {
      const command = {
        commandId: canvasCommandId(),
        objectKind: 'task',
        objectIds: [taskId],
        operation: { type: 'change_parent', parentId: parentTaskId },
      } as ObjectCommandIn;
      void history.execute(command, 'Move Task branch');
    },
    [history],
  );
  const activeError = creation.error;
  const clearActiveError = creation.clearError;
  const createTask = useCallback(
    (returnFocusTo?: HTMLElement | null) => {
      setCreatedOutsideScopeId(null);
      openCreate(
        {
          kind: 'task',
          initialWorkspaceId: orgId,
          sameWorkspaceCompletion: 'stay',
          ...(scope.projectId === undefined ? {} : { defaultProjectId: scope.projectId }),
          onCreated: (created) => {
            const outsideStructuralScope =
              scope.rootTaskId !== undefined ||
              (scope.projectId !== undefined && created.projectId !== scope.projectId);
            if (outsideStructuralScope) {
              setCreatedSelectionId(null);
              setSettledCreatedSelectionId(null);
              setCreatedOutsideScopeId(created.id);
              return;
            }
            setSelectedId(created.id);
            setCreatedOutsideScopeId(null);
            setCreatedSelectionId(created.id);
            setSettledCreatedSelectionId(null);
            void queryClient.invalidateQueries({ queryKey: graphKey }).then(() => {
              setSettledCreatedSelectionId(created.id);
            });
          },
        },
        returnFocusTo,
      );
    },
    [graphKey, openCreate, orgId, queryClient, scope.projectId, scope.rootTaskId],
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
      setSettledCreatedSelectionId(null);
    },
    [flowInstance, selectionSurfaceId],
  );
  const createdHidden =
    createdSelectionId !== null &&
    settledCreatedSelectionId === createdSelectionId &&
    !canvasNodes.some(({ id }) => id === createdSelectionId) &&
    (viewState.filters.length > 0 || needle.length > 0);

  const body = (() => {
    if (isLoading) {
      // placeholder: the graph itself — which tasks and dependencies exist, and therefore the
      // shape of the layout. There is no meaningful partial rendering of a node-link diagram, so
      // the canvas area is covered while its toolbar and controls stay live.
      return <Skeleton className="absolute inset-2 rounded-lg" />;
    }
    if (error !== null) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <EmptyState icon={Workflow} title="Couldn’t load the graph" body={error} />
        </div>
      );
    }
    return (
      <CanvasSelectionRetentionProvider
        scopeKey={commandScopeKey}
        items={selectionItems}
        propertySnapshots={propertySnapshots}
        surfaceId={selectionSurfaceId}
        organizationId={orgId}
      >
        <CanvasCommandProviderWithHistory
          objectKind="task"
          canEdit={canEdit}
          history={history}
          onCreateObject={createTask}
          onOpenObject={(object) => {
            setSelectedId(object.id);
          }}
        >
          <CanvasSelectionFrame label="Task graph">
            <CanvasActionsProvider value={canvasActions}>
              <Canvas
                nodes={canvasNodes}
                edges={filtered.edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                density={density}
                layoutDirection={display.direction}
                disableLayout
                layoutReady={aspectReady}
                nodeColor={taskStateColor}
                minimap={renderChrome === undefined ? display.minimap : true}
                interactive={canEdit}
                highlightIds={display.critical ? criticalIds : null}
                focusOn={focusOn}
                onExpand={onExpand}
                onSelectNode={handleSelect}
                onNavigate={navigate}
                onConnectEdge={addDependency}
                onDeleteEdge={(edge) => {
                  removeDependency(edge.source, edge.target);
                }}
                onReparentEdge={reparentTask}
                onInit={setFlowInstance}
                onRelayout={() => {
                  setLayoutEpoch((current) => current + 1);
                }}
              >
                <CanvasSelectionBridge
                  requestedSelectionId={createdSelectionId}
                  requestedSelectionReady={
                    createdSelectionId !== null &&
                    canvasNodes.some(({ id }) => id === createdSelectionId)
                  }
                  onRequestedSelectionApplied={applyCreatedSelection}
                />
                <BulkActionsBar />
                <CanvasCommandNotice />
                {createdHidden ? (
                  <CanvasCreatedHiddenNotice
                    message="Created, but hidden by current filters"
                    actionLabel="Clear filters"
                    onAction={() => {
                      setFilters([]);
                      patchDisplay({ search: '' });
                      setSettledCreatedSelectionId(null);
                      void queryClient.invalidateQueries({ queryKey: graphKey }).then(() => {
                        setSettledCreatedSelectionId(createdSelectionId);
                      });
                    }}
                  />
                ) : null}
                {createdOutsideScopeId !== null ? (
                  <CanvasCreatedHiddenNotice
                    message={
                      scope.projectId !== undefined
                        ? 'Created, but outside this Project'
                        : 'Created, but outside this Task neighborhood'
                    }
                    actionLabel="Open Task"
                    onAction={() => {
                      navigate(createdOutsideScopeId);
                    }}
                  />
                ) : null}
                {isEmpty ? (
                  <Panel position="top-center" className="!top-1/2 !-translate-y-1/2">
                    <EmptyState
                      icon={Workflow}
                      title="No tasks to map yet"
                      body="Right-click the canvas or use the New Task command to add the first Task."
                    />
                  </Panel>
                ) : null}
                {display.ready && readyNodes.length > 0 ? (
                  <Panel position="bottom-left">
                    <Surface tone="raised" pad="tight" className="max-h-56 w-56 overflow-auto">
                      <p className="text-on-surface-variant text-label-medium mb-1">
                        Ready to start
                      </p>
                      {readyNodes.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            navigate(n.id);
                          }}
                          className="hover:bg-surface-container-highest text-on-surface text-body-small block w-full truncate rounded px-1.5 py-1 text-left"
                        >
                          {taskData(n).title}
                        </button>
                      ))}
                    </Surface>
                  </Panel>
                ) : null}
                {selectedNode !== null ? (
                  <Panel position="top-right">
                    <NodePeek
                      node={selectedNode}
                      nodes={filtered.nodes}
                      edges={filtered.edges}
                      canEdit={canEdit}
                      onNavigate={navigate}
                      onSetComplete={setComplete}
                      onClose={() => {
                        setSelectedId(null);
                      }}
                    />
                  </Panel>
                ) : null}
                {/*
            One strip, two messages. A write that failed and an edit that can be taken back both
            want the same place — under the graph, out of the way of the nodes — and only one of
            them is ever live, because a successful removal clears the error and a failure never
            offers an undo.
          */}
                {activeError !== null ? (
                  <Panel position="bottom-center">
                    <Surface
                      tone="prominent"
                      shape="pill"
                      className="text-state-canceled text-body-medium flex items-center gap-2 py-1.5 pr-2 pl-4"
                    >
                      {activeError}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        onClick={clearActiveError}
                        aria-label="Dismiss"
                      >
                        <X className="size-4" />
                      </Button>
                    </Surface>
                  </Panel>
                ) : null}
              </Canvas>
            </CanvasActionsProvider>
          </CanvasSelectionFrame>
        </CanvasCommandProviderWithHistory>
      </CanvasSelectionRetentionProvider>
    );
  })();

  const bar = (
    <GraphViewBar
      catalog={catalog}
      state={viewState}
      onFiltersChange={setFilters}
      onGroupByChange={setGroupBy}
      onSortChange={() => {
        // The graph declares no sortable fields — rank order is the layout's job — so the shared
        // bar renders no Ordering section and this is never reached.
      }}
      display={display}
      onDisplayChange={patchDisplay}
      showDepth={isNeighborhood}
      depth={depth}
      counts={counts}
    />
  );

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      {renderChrome?.(bar)}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {body}
      </div>
    </div>
  );
}
