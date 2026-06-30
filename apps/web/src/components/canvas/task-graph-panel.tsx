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

import Canvas from './canvas';
import GraphToolbar, {
  EMPTY_FILTER,
  type FilterOption,
  type GraphFilter,
  UNASSIGNED,
} from './graph-toolbar';
import NodePeek from './node-peek';
import TaskNode, { type ResolvedAssignee, type TaskNodeData } from './task-node';
import { type CanvasDensity, type LayoutDirection } from './use-dagre-layout';
import { type TaskGraphScope, useTaskGraph } from './use-task-graph';
import { useTaskGraphMutations } from './use-task-graph-mutations';

/** Stable node-type registry (must not be re-created per render — xyflow warns otherwise). */
const NODE_TYPES = { task: TaskNode };

/** Props for {@link TaskGraphPanel}. */
export interface TaskGraphPanelProps {
  /** The scope to render (org / project / task-neighborhood). */
  scope: TaskGraphScope;
  /** Canvas density; default `compact` since the common host is an embed. */
  density?: CanvasDensity;
  /** Show the filter + layout toolbar (focused view only). */
  showToolbar?: boolean;
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
    const d = n.data as TaskNodeData;
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

/** A scoped, interactive dependency-graph canvas with peek, editing, and optional toolbar. */
export default function TaskGraphPanel({
  scope,
  density = 'compact',
  showToolbar = false,
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

  const members = membersQ.data?.items;
  const agents = agentsQ.data?.items;
  const projects = projectsQ.data?.items;
  const roles = rolesQ.data?.items;

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

  const { nodes, edges, isLoading, error, isEmpty } = useTaskGraph(scope, density, {
    resolveAssignee,
    resolveProjectName,
  });

  const mutations = useTaskGraphMutations(scope);
  const [filter, setFilter] = useState<GraphFilter>(EMPTY_FILTER);
  const [direction, setDirection] = useState<LayoutDirection>('LR');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const counts = useMemo(
    () => ({
      tasks: filtered.nodes.length,
      deps: filtered.edges.filter((e) => (e.data as { kind?: string }).kind === 'dependency')
        .length,
      blocked: filtered.nodes.filter((n) => (n.data as TaskNodeData).isBlocked).length,
    }),
    [filtered],
  );

  const selectedNode = useMemo(
    () => (selectedId === null ? null : (filtered.nodes.find((n) => n.id === selectedId) ?? null)),
    [selectedId, filtered.nodes],
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
      <Canvas
        nodes={filtered.nodes}
        edges={filtered.edges}
        nodeTypes={NODE_TYPES}
        density={density}
        layoutDirection={direction}
        interactive={canEdit}
        onExpand={onExpand}
        onSelectNode={handleSelect}
        onNavigate={navigate}
        onConnectEdge={mutations.addDependency}
        onDeleteEdge={(edge) => {
          mutations.removeDependency(edge.source, edge.target);
        }}
      >
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
            counts={counts}
          />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  );
}
