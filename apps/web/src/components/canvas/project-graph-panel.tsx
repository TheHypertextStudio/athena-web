'use client';

/**
 * `components/canvas/project-graph-panel` — the Projects "Dependencies" lens.
 *
 * @remarks
 * A read-only host for the shared {@link "./canvas"#default | Canvas}: it projects the portfolio
 * overview rows onto xyflow {@link Node}s (rendered by {@link "./project-node"#default | ProjectNode})
 * and derives the dependency {@link Edge}s from each project's upstream blockers, then lets the
 * canvas's dagre pass lay everything out. It is deliberately non-interactive — no edge
 * connect/delete/reparent callbacks — so the portfolio graph reads as a navigable map rather than an
 * editor; double-clicking a node routes to that project. React Flow is heavy, so the Projects list
 * lazy-loads this module only when the Dependencies lens is opened.
 */
import type { Health, ProjectOverviewItem, ProjectStatus } from '@docket/types';
import { type Edge, type Node } from '@xyflow/react';
import { useRouter } from 'next/navigation';
import { type JSX, useMemo } from 'react';

import Canvas from '@/components/canvas/canvas';
import ProjectNode, { type ProjectNodeData, projectData } from '@/components/canvas/project-node';

/** The registered node renderers for this canvas (only the read-only project card). */
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
  /** The owning org id, used to build project navigation hrefs. */
  orgId: string;
}

/**
 * The Projects Dependencies lens: a read-only dependency canvas over the portfolio rows.
 *
 * @param props - See {@link ProjectGraphPanelProps}.
 */
export function ProjectGraphPanel({ rows, orgId }: ProjectGraphPanelProps): JSX.Element {
  const router = useRouter();

  const nodes = useMemo<Node[]>(() => {
    const rowIds = new Set(rows.map((item) => item.id));
    return rows.map((item) => {
      const waitingCount = item.blockedByIds.filter((upstreamId) => rowIds.has(upstreamId)).length;
      const data: ProjectNodeData = {
        name: item.name,
        status: item.status as ProjectStatus,
        health: item.health ?? null,
        progress: progressPercent(item),
        targetDate: item.targetDate ?? null,
        waitingCount,
        density: 'full',
      };
      return { id: item.id, type: 'project', position: { x: 0, y: 0 }, data };
    });
  }, [rows]);

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
        interactive={false}
        density="full"
        nodeColor={projectHealthColor}
        // Read-only graph with no node-peek, so a single click opens the project (matching the old
        // lens's link behavior); double-click routes too.
        onSelectNode={(id) => {
          router.push(`/orgs/${orgId}/projects/${id}`);
        }}
        onNavigate={(id) => {
          router.push(`/orgs/${orgId}/projects/${id}`);
        }}
      />
    </div>
  );
}
