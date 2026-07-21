'use client';

/**
 * `components/canvas/project-node` — the node renderer for a PROJECT on a dependency canvas.
 *
 * @remarks
 * A card mirroring {@link "./task-node"#default | TaskNode}'s shell — the same left/right
 * `Handle` placement, per-density size tokens, MD3 tonal surface (`bg-surface-container-high`
 * card over an `outline-variant` border), and selected ring — but framed for a *bounded effort*
 * rather than a single task. It leads with the shared {@link "@docket/ui/components"#StatusIcon}
 * glyph for the project lifecycle (via {@link statusGlyphType}), the project name (line-clamped),
 * and a {@link "../projects/project-status"#ProjectStatusBadge | ProjectStatusBadge} tinted by the
 * project's {@link Health}; at full density it adds a progress bar and target date. The node is
 * purely presentational and read-only — it carries no toolbar and never depends on the canvas
 * actions context.
 *
 * The card carries a stable `view-transition-name` (`project-node-<id>`) so filtering, relayout,
 * or expanding the canvas morphs the same node between arrangements rather than hard-swapping it.
 */
import type { Health, ProjectStatus } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/projects/health';
import { ProjectStatusBadge, statusGlyphType } from '@/components/projects/project-status';
import { formatCalendarDate } from '@/lib/format-date';

import { projectNodeTransitionName } from './transition-name';
import { useLod } from './use-lod';

/**
 * The data a {@link ProjectNode} renders; lives on the xyflow node's `data`.
 *
 * @remarks
 * Only project-scoped presentation fields — no task-only concerns (priority, assignee, workflow
 * state, milestone) leak in here.
 */
export interface ProjectNodeData extends Record<string, unknown> {
  /** The project name (line-clamped in the card). */
  name: string;
  /** The project's lifecycle status (drives the leading glyph + status badge). */
  status: ProjectStatus;
  /** The project's health verdict, or `null` when unset (drives the health tint). */
  health: Health | null;
  /** Weighted completion, 0–100 (drives the full-density progress bar). */
  progress: number;
  /** ISO target date, or `null` (shown at full density). */
  targetDate: string | null;
  /** Count of upstream blockers still open within this view (0 when none). */
  waitingCount: number;
  /** The canvas density, threaded through so the node sizes to its host. */
  density: 'compact' | 'full';
  /** Whether this node is the focus/root of a neighborhood view. */
  isRoot?: boolean;
}

/** Read the typed {@link ProjectNodeData} off an xyflow node (one place for the `data` cast). */
export function projectData(node: { data: unknown }): ProjectNodeData {
  return node.data as ProjectNodeData;
}

/** A single project card on the canvas. */
function ProjectNodeComponent({ id, data, selected }: NodeProps): React.JSX.Element {
  const { name, status, health, progress, targetDate, waitingCount, density, isRoot } =
    data as ProjectNodeData;
  const compact = density === 'compact';
  // Low-detail (zoomed out): show just the glyph + name, dropping the badge row and progress.
  const lod = useLod();
  const showDetail = !compact && !lod;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const targetLabel = formatCalendarDate(targetDate, { month: 'short', day: 'numeric' });
  const waiting = waitingCount > 0;

  return (
    <div
      style={{ viewTransitionName: projectNodeTransitionName(id) }}
      className={cn(
        'group bg-surface-container-high relative flex flex-col justify-center gap-1.5 rounded-lg border shadow-sm transition-colors',
        compact ? 'h-14 w-[224px] px-3' : 'h-[96px] w-[268px] px-3.5',
        isRoot ? 'border-primary' : waiting ? 'border-state-started/60' : 'border-outline-variant',
        selected && 'ring-primary ring-2',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-outline-variant !bg-surface !size-2"
      />

      <div className="flex min-w-0 items-center gap-2">
        <StatusIcon type={statusGlyphType(status)} />
        <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate font-medium">
          {name}
        </span>
        {health !== null ? (
          <span
            aria-label={HEALTH_LABEL[health]}
            title={HEALTH_LABEL[health]}
            className={cn('size-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[health])}
          />
        ) : null}
      </div>

      {showDetail ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <ProjectStatusBadge status={status} />
            {waiting ? (
              <span className="text-state-started shrink-0 text-xs font-medium">
                {waitingCount} waiting
              </span>
            ) : null}
            {targetLabel !== null ? (
              <span className="text-on-surface-variant ml-auto shrink-0 text-xs tabular-nums">
                {targetLabel}
              </span>
            ) : null}
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${pct}% complete`}
            className="bg-surface-container h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        className="!border-outline-variant !bg-surface !size-2"
      />
    </div>
  );
}

/** Memoized so unrelated graph updates don't re-render every node. */
const ProjectNode = memo(ProjectNodeComponent);
export default ProjectNode;
