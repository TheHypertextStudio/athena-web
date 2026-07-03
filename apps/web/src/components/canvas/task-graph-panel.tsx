'use client';

/**
 * `components/canvas/task-graph-panel` — the dependency-graph host every surface renders.
 *
 * @remarks
 * Feeds {@link useTaskGraph} for a scope into the generic {@link Canvas} and owns everything
 * task-specific: resolving assignee avatars + project names (from the org's members/agents/
 * projects), the `contribute` edit gate, the live-edit mutations (drag to add a `blocks` edge,
 * Delete to remove one, quick state change), the selection peek, and — when `showToolbar` — the
 * filter + layout toolbar. Loading / empty / error states are handled here so hosts stay
 * declarative. Embeds use the compact density (click navigates); the focused view passes
 * `showToolbar` + full density (click peeks, double-click navigates).
 */
import { EmptyState } from '@docket/ui/components';
import { Workflow, X } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type Edge, type Node, Panel } from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';

import BulkActionsBar from './bulk-actions-bar';
import Canvas from './canvas';
import { CanvasActionsProvider } from './canvas-actions-context';
import GroupNode from './group-node';
import { edgeKind } from './use-graph-interactions';
import GraphToolbar, {
  EMPTY_FILTER,
  type FilterOption,
  type GraphFilter,
  type GroupBy,
  UNASSIGNED,
} from './graph-toolbar';
import { type GroupSpec, layoutGrouped } from './use-grouped-layout';
import NodePeek from './node-peek';
import TaskNode, { type ResolvedAssignee, taskData } from './task-node';
import { type CanvasDensity, type LayoutDirection } from './use-dagre-layout';
import { type TaskGraphScope, useTaskGraph } from './use-task-graph';
import { useTaskGraphMutations } from './use-task-graph-mutations';

/** Stable node-type registry (must not be re-created per render — xyflow warns otherwise). */
const NODE_TYPES = { task: TaskNode, group: GroupNode };

/** Props for {@link TaskGraphPanel}. */
export interface TaskGraphPanelProps {
  /** The scope to render (org / project / task-neighborhood). */
  scope: TaskGraphScope;
  /** Canvas density; default `compact` since the common host is an embed. */
  density?: CanvasDensity;
  /** Show the filter + layout toolbar (focused view only). */
  showToolbar?: boolean;
  /** Controlled filter (e.g. URL-backed); falls back to internal state when omitted. */
  filter?: GraphFilter;
  /** Controlled filter setter; paired with `filter`. */
  onFilterChange?: (filter: GraphFilter) => void;
  /** Controlled layout direction; falls back to internal state when omitted. */
  direction?: LayoutDirection;
  /** Controlled direction setter; paired with `direction`. */
  onDirectionChange?: (direction: LayoutDirection) => void;
  /** When set, shows an expand affordance that calls this (e.g. navigate to the full view). */
  onExpand?: () => void;
  /** Extra classes for the container. */
  className?: string;
}

/** Apply the active filter to the node set; returns surviving nodes + edges (pruned). */
function applyFilter(
  nodes: readonly Node[],
  edges: readonly Edge[],
  filter: GraphFilter,
): { nodes: Node[]; edges: Edge[] } {
  const needle = filter.search.trim().toLowerCase();
  const keep = (n: Node): boolean => {
    const d = taskData(n);
    if (needle.length > 0 && !d.title.toLowerCase().includes(needle)) return false;
    if (filter.projects.size > 0 && !(d.projectId !== null && filter.projects.has(d.projectId)))
      return false;
    if (filter.assignees.size > 0 && !filter.assignees.has(d.assigneeId ?? UNASSIGNED))
      return false;
    if (filter.priorities.size > 0 && !filter.priorities.has(d.priority)) return false;
    if (filter.stateTypes.size > 0 && !filter.stateTypes.has(stateTypeOf(d.state))) return false;
    return true;
  };
  const keptNodes = nodes.filter(keep);
  const ids = new Set(keptNodes.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes: keptNodes, edges: keptEdges };
}

/** Minimap node color by workflow-state token (the canvas is generic; the host injects this). */
function taskStateColor(node: Node): string {
  return `var(--color-state-${stateTypeOf(taskData(node).state)})`;
}

/** A scoped, interactive dependency-graph canvas with peek, editing, and optional toolbar. */
export default function TaskGraphPanel({
  scope,
  density = 'compact',
  showToolbar = false,
  filter: controlledFilter,
  onFilterChange,
  direction: controlledDirection,
  onDirectionChange,
  onExpand,
  className,
}: TaskGraphPanelProps): React.JSX.Element {
  const router = useRouter();
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
      return { name: `Member ${assigneeId.slice(0, 6)}`, kind: 'human' };
    },
    [members, agents],
  );
  const resolveProjectName = useCallback(
    (projectId: string | null): string | null => {
      if (projectId === null) return null;
      return projects?.find((p) => p.id === projectId)?.name ?? null;
    },
    [projects],
  );

  // Filter + layout are controlled when the host supplies them (URL-backed full view), else local.
  const [localFilter, setLocalFilter] = useState<GraphFilter>(EMPTY_FILTER);
  const [localDirection, setLocalDirection] = useState<LayoutDirection>('LR');
  const filter = controlledFilter ?? localFilter;
  const setFilter = onFilterChange ?? setLocalFilter;
  const direction = controlledDirection ?? localDirection;
  const setDirection = onDirectionChange ?? setLocalDirection;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCritical, setShowCritical] = useState(false);
  const [showReady, setShowReady] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [depth, setDepth] = useState(scope.depth ?? 2);

  // In the neighborhood scope, the depth stepper overrides the incoming scope depth live.
  const isNeighborhood = scope.rootTaskId !== undefined;
  const effectiveScope = useMemo(
    () => (isNeighborhood ? { ...scope, depth } : scope),
    [isNeighborhood, scope, depth],
  );

  const { nodes, edges, isLoading, error, isEmpty } = useTaskGraph(effectiveScope, density, {
    resolveAssignee,
    resolveProjectName,
  });
  const mutations = useTaskGraphMutations(effectiveScope);

  const filtered = useMemo(
    () => (showToolbar ? applyFilter(nodes, edges, filter) : { nodes, edges }),
    [showToolbar, nodes, edges, filter],
  );

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

  const projectOptions: FilterOption[] = useMemo(
    () => (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );
  const assigneeOptions: FilterOption[] = useMemo(
    () => [
      { value: UNASSIGNED, label: 'Unassigned' },
      ...(members ?? []).map((m) => ({ value: m.actorId, label: m.displayName })),
    ],
    [members],
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
  const searchActive = filter.search.trim().length > 0;
  const focusOn = useMemo(
    () => (searchActive ? filtered.nodes.map((n) => n.id) : undefined),
    [searchActive, filtered.nodes],
  );

  const selectedNode = useMemo(
    () => (selectedId === null ? null : (filtered.nodes.find((n) => n.id === selectedId) ?? null)),
    [selectedId, filtered.nodes],
  );

  // Node-level actions for the per-node toolbar (create subtask / mark done / open).
  const nodeActions = useMemo(
    () => ({
      canEdit,
      navigate,
      setState: mutations.setState,
      createSubtask: mutations.createSubtask,
    }),
    [canEdit, navigate, mutations.setState, mutations.createSubtask],
  );

  // Grouping: map the chosen axis to a group key + label; null when ungrouped.
  const groupSpec = useMemo<GroupSpec | null>(() => {
    if (groupBy === 'none') return null;
    if (groupBy === 'project') {
      return {
        groupOf: (n) => taskData(n).projectId,
        labelOf: (id) => projects?.find((p) => p.id === id)?.name ?? 'Project',
      };
    }
    if (groupBy === 'team') {
      return {
        groupOf: (n) => taskData(n).teamId,
        labelOf: (id) => teams?.find((t) => t.id === id)?.name ?? 'Team',
      };
    }
    return {
      groupOf: (n) => taskData(n).milestoneId,
      labelOf: (id) => milestones?.find((m) => m.id === id)?.name ?? 'Milestone',
    };
  }, [groupBy, projects, teams, milestones]);

  // When grouped, pre-lay-out into swimlanes (dagre per lane); otherwise the canvas lays out.
  const canvasNodes = useMemo(
    () =>
      groupSpec === null
        ? filtered.nodes
        : layoutGrouped(filtered.nodes, filtered.edges, density, direction, groupSpec),
    [groupSpec, filtered, density, direction],
  );

  const body = (() => {
    if (isLoading) {
      return <Skeleton className="absolute inset-2 rounded-lg" />;
    }
    if (error !== null) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <EmptyState icon={Workflow} title="Couldn’t load the graph" body={error} />
        </div>
      );
    }
    if (isEmpty) {
      return (
        <div className="flex h-full items-center justify-center p-4">
          <EmptyState
            icon={Workflow}
            title="No dependencies yet"
            body="Tasks in this scope have no dependency or subtask links to map."
          />
        </div>
      );
    }
    return (
      <CanvasActionsProvider value={nodeActions}>
        <Canvas
          nodes={canvasNodes}
          edges={filtered.edges}
          nodeTypes={NODE_TYPES}
          density={density}
          layoutDirection={direction}
          disableLayout={groupSpec !== null}
          nodeColor={taskStateColor}
          interactive={canEdit}
          highlightIds={showCritical ? criticalIds : null}
          focusOn={focusOn}
          onExpand={onExpand}
          onSelectNode={handleSelect}
          onNavigate={navigate}
          onConnectEdge={mutations.addDependency}
          onDeleteEdge={(edge) => {
            mutations.removeDependency(edge.source, edge.target);
          }}
          onReparentEdge={mutations.reparent}
        >
          <BulkActionsBar />
          {showReady && readyNodes.length > 0 ? (
            <Panel position="bottom-left">
              <div className="border-outline-variant bg-surface-container max-h-56 w-56 overflow-auto rounded-lg border p-2 shadow-lg">
                <p className="text-on-surface-variant mb-1 text-xs font-medium uppercase">
                  Ready to start
                </p>
                {readyNodes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      navigate(n.id);
                    }}
                    className="hover:bg-surface-container-high text-on-surface block w-full truncate rounded px-1.5 py-1 text-left text-xs"
                  >
                    {taskData(n).title}
                  </button>
                ))}
              </div>
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
                onSetState={mutations.setState}
                onClose={() => {
                  setSelectedId(null);
                }}
              />
            </Panel>
          ) : null}
          {mutations.error !== null ? (
            <Panel position="bottom-center">
              <div className="border-state-canceled/40 bg-surface-container text-state-canceled text-body flex items-center gap-2 rounded-lg border px-3 py-1.5 shadow-lg">
                {mutations.error}
                <button type="button" onClick={mutations.clearError} aria-label="Dismiss">
                  <X className="size-4" />
                </button>
              </div>
            </Panel>
          ) : null}
        </Canvas>
      </CanvasActionsProvider>
    );
  })();

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      {showToolbar ? (
        <div className="border-outline-variant border-b px-4 py-2.5 @2xl:px-6">
          <GraphToolbar
            filter={filter}
            onChange={setFilter}
            projectOptions={projectOptions}
            assigneeOptions={assigneeOptions}
            direction={direction}
            onDirectionChange={setDirection}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            showCritical={showCritical}
            onToggleCritical={() => {
              setShowCritical((v) => !v);
            }}
            showReady={showReady}
            onToggleReady={() => {
              setShowReady((v) => !v);
            }}
            depth={isNeighborhood ? depth : undefined}
            onDepthChange={isNeighborhood ? setDepth : undefined}
            counts={counts}
          />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  );
}
