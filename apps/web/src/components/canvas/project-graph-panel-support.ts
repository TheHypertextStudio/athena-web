'use client';

/**
 * `components/canvas/project-graph-panel-support` — the Dependencies lens's command and peek hooks.
 *
 * @remarks
 * Two pieces of {@link "./project-graph-panel"#ProjectGraphPanel | ProjectGraphPanel} that do not
 * need its JSX: the dependency commands, which patch the Project overview query optimistically so
 * the edge appears before the command round-trips, and the peek model that resolves the selected
 * row and both directions of its dependencies from the same rows the canvas is drawn from.
 */
import type { ObjectCommandIn, ObjectCommandReceipt } from '../../lib/contracts/object-command';
import type { ProjectOverviewItem, ProjectOverviewOut } from '../../lib/contracts/project';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Edge } from '@xyflow/react';
import { useCallback, useMemo } from 'react';

import type { CanvasReceiptDirection } from './canvas-retained-snapshots';
import type { ProjectPeekNeighbor } from './project-peek';
import {
  applyProjectDependencyChange,
  type ProjectDependencyChange,
  projectDependencyChangesFromReceipt,
} from './project-overview-optimistic';
import { dependencyFeedback } from './dependency-feedback';
import { type CanvasCommandHistoryControls, canvasCommandId } from './use-canvas-command-history';
import type { CanvasReceiptListener } from './use-canvas-receipt-applier';

/** Inputs for {@link useProjectGraphCommands}. */
export interface ProjectGraphCommandsOptions {
  /** The rows the canvas draws, used for notice copy. */
  readonly rows: readonly ProjectOverviewItem[];
  /** The bound object-command history. */
  readonly history: CanvasCommandHistoryControls;
  /** The query client that holds the Project overview. */
  readonly queryClient: QueryClient;
  /** The Project overview query key. */
  readonly overviewKey: QueryKey;
}

/** Edge handlers for the dependencies canvas. */
export interface ProjectGraphCommands {
  /** Create a `blocking → blocked` dependency. */
  readonly addDependency: (source: string, target: string) => void;
  /** Remove the dependency an edge represents. */
  readonly removeDependency: (edge: Edge) => void;
}

/** Project the overview's named blocking relationships into accessible React Flow edges. */
export function projectRowsToDependencyEdges(rows: readonly ProjectOverviewItem[]): Edge[] {
  const names = new Map(rows.map((item) => [item.id, item.name]));
  const rowIds = new Set(names.keys());
  return rows.flatMap((item) =>
    item.blockedByIds
      .filter((upstreamId) => rowIds.has(upstreamId))
      .map((upstreamId) => ({
        id: `${upstreamId}->${item.id}`,
        source: upstreamId,
        target: item.id,
        ariaLabel: `${names.get(upstreamId) ?? upstreamId} blocks ${item.name}`,
      })),
  );
}

/** Both directions of a Project's dependencies. */
export interface ProjectPeekNeighbors {
  /** Projects that must finish first. */
  readonly blockedBy: readonly ProjectPeekNeighbor[];
  /** Projects waiting on this one. */
  readonly blocks: readonly ProjectPeekNeighbor[];
}

/** The selected Project and both directions of its dependencies. */
export interface ProjectPeekModel {
  /** The selected row, or null when nothing is selected or the filter excludes it. */
  readonly selected: ProjectOverviewItem | null;
  /** The selected row's lead, resolved from the member list. */
  readonly selectedLeadName: string | null;
  /** Upstream blockers and downstream dependents. */
  readonly neighbors: ProjectPeekNeighbors;
}

/** The shape a cached overview entry must have before it is patched. */
interface OverviewLike {
  readonly items?: unknown;
}

/** The member fields the peek needs to name a lead. */
export interface ProjectPeekMember {
  readonly actorId: string;
  readonly displayName: string;
}

/** The member list response the peek reads, possibly not loaded yet. */
export interface ProjectPeekMembers {
  readonly items: readonly ProjectPeekMember[];
}

function isOverviewData(value: unknown): value is ProjectOverviewOut {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as OverviewLike).items)
  );
}

/** Patch the cached Project overview in place; a missing cache entry is left for the refetch. */
function patchOverview(
  queryClient: QueryClient,
  overviewKey: QueryKey,
  changes: readonly ProjectDependencyChange[],
): void {
  if (changes.length === 0) return;
  const cached = queryClient.getQueryData(overviewKey);
  if (!isOverviewData(cached)) return;
  const items = changes.reduce(applyProjectDependencyChange, cached.items);
  queryClient.setQueryData(overviewKey, { ...cached, items });
}

/**
 * A receipt listener that keeps the Project overview's dependency lists in step with every
 * settled command, forward or replayed.
 *
 * @param queryClient - The query client that holds the overview.
 * @param overviewKey - The Project overview query key.
 */
export function useProjectOverviewReceiptApplier(
  queryClient: QueryClient,
  overviewKey: QueryKey,
): CanvasReceiptListener {
  return useCallback(
    (receipt: ObjectCommandReceipt, direction: CanvasReceiptDirection) => {
      patchOverview(
        queryClient,
        overviewKey,
        projectDependencyChangesFromReceipt(receipt, direction),
      );
    },
    [overviewKey, queryClient],
  );
}

/**
 * Bind dependency edge edits to the object-command history with an optimistic overview patch.
 *
 * @remarks
 * The overview cache is patched before the command is posted, so the edge is drawn at once. A
 * refused or failed command restores the pre-patch snapshot, unless a refetch has already replaced
 * the optimistic entry, in which case the server's answer stands.
 */
export function useProjectGraphCommands({
  rows,
  history,
  queryClient,
  overviewKey,
}: ProjectGraphCommandsOptions): ProjectGraphCommands {
  const executeDependency = useCallback(
    async (change: ProjectDependencyChange): Promise<void> => {
      const command = {
        commandId: canvasCommandId(),
        objectKind: 'project',
        objectIds: [change.blockingId, change.blockedId],
        operation: {
          type: change.type,
          blockingId: change.blockingId,
          blockedId: change.blockedId,
        },
      } as ObjectCommandIn;
      const blockingName = rows.find(({ id }) => id === change.blockingId)?.name ?? 'Project';
      const blockedName = rows.find(({ id }) => id === change.blockedId)?.name ?? 'Project';
      const snapshot = queryClient.getQueryData(overviewKey);
      patchOverview(queryClient, overviewKey, [change]);
      const optimistic = queryClient.getQueryData(overviewKey);
      const result = await history.execute(
        command,
        dependencyFeedback(change.type, blockingName, blockedName),
      );
      if (result === null && queryClient.getQueryData(overviewKey) === optimistic) {
        queryClient.setQueryData(overviewKey, snapshot);
      }
    },
    [history, overviewKey, queryClient, rows],
  );
  const addDependency = useCallback(
    (source: string, target: string) => {
      void executeDependency({ type: 'add_dependency', blockingId: source, blockedId: target });
    },
    [executeDependency],
  );
  const removeDependency = useCallback(
    (edge: Edge) => {
      void executeDependency({
        type: 'remove_dependency',
        blockingId: edge.source,
        blockedId: edge.target,
      });
    },
    [executeDependency],
  );
  return { addDependency, removeDependency };
}

/**
 * Resolve the selected row, its lead, and both directions of its dependencies.
 *
 * @remarks
 * Resolved from `rows` — the same array the canvas is drawn from — so the peek can never disagree
 * with the graph, and an optimistic edge shows up in both at once. A neighbour the current filter
 * has excluded is still listed (a blocker you cannot see is the one that hurts) but is marked as
 * off-canvas, because there is no node for the selection to move to.
 *
 * @param rows - The rows the canvas draws.
 * @param selectedId - The selected Project id, or null.
 * @param members - The workspace member list response, used to name the lead.
 */
export function useProjectPeekModel(
  rows: readonly ProjectOverviewItem[],
  selectedId: string | null,
  members: ProjectPeekMembers | undefined,
): ProjectPeekModel {
  const selected = useMemo(
    () => rows.find((item) => item.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedLeadName = useMemo(() => {
    if (!selected?.leadId) return null;
    return members?.items.find((member) => member.actorId === selected.leadId)?.displayName ?? null;
  }, [members, selected]);
  const neighbors = useMemo(() => {
    const empty: readonly ProjectPeekNeighbor[] = [];
    if (!selected) return { blockedBy: empty, blocks: empty };
    const byId = new Map(rows.map((item) => [item.id as string, item] as const));
    const resolve = (ids: readonly string[]): readonly ProjectPeekNeighbor[] =>
      ids.map((id) => {
        const row = byId.get(id);
        return {
          id,
          name: row?.name ?? 'Filtered out',
          status: row?.status ?? '',
          onCanvas: row !== undefined,
        };
      });
    return { blockedBy: resolve(selected.blockedByIds), blocks: resolve(selected.blocksIds) };
  }, [rows, selected]);
  return { selected, selectedLeadName, neighbors };
}
