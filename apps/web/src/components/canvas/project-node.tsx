'use client';

/**
 * `components/canvas/project-node` — the node renderer for a PROJECT on a dependency canvas.
 *
 * @remarks
 * A card mirroring {@link "./task-node"#default | TaskNode}'s shell — the same left/right
 * `Handle` placement, per-density size tokens, and selected treatment — but framed for a *bounded
 * effort* rather than a single task. It leads with the shared
 * {@link "../entity-display/work-status"#WorkStatusIcon | WorkStatusIcon} glyph for the project's
 * status category, the project name (line-clamped), and a
 * {@link "../entity-display/work-status"#WorkStatusBadge | WorkStatusBadge}; at full density it
 * adds a *labelled* task-completion bar and the target date. The node is purely presentational and
 * read-only — it carries no toolbar and never depends on the canvas actions context.
 *
 * **Separation is tonal, not drawn.** The card carried a 1px hairline and a drop shadow, which at
 * a dozen cards turned the canvas into a sheet of boxes floating over a dot grid — the "sharp
 * borders, doesn't feel immersive" note. It now sits a tonal step above the canvas and nothing
 * else; the waiting and root states, which the border used to carry, become a leading accent bar
 * and a selection ring respectively, so no state needs an outline to be visible.
 *
 * **The progress bar says what it measures.** An unexplained rule under the status chip is not
 * data, it is decoration that looks like data. The bar is now preceded by its own reading —
 * `3/8 tasks` — and carries both a hover tooltip and an accessible name saying the same thing.
 *
 * The card carries a stable `view-transition-name` (`project-node-<id>`) so filtering, relayout,
 * or expanding the canvas morphs the same node between arrangements rather than hard-swapping it.
 */
import type { Health, ProjectStatus } from '@docket/types';
import { ArrowRight } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import Link from '@/components/docket-link';
import { memo } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL } from '@/components/projects/health';
import { ObjectSurface } from '@/components/objects/object-surface';
import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { WorkStatusBadge, WorkStatusIcon } from '@/components/entity-display/work-status';
import { formatCalendarDate } from '@/lib/format-date';
import { useSelectableRow } from '@/components/selection';

import { projectNodeTransitionName } from './transition-name';
import { useLod } from './use-lod';

/** Project card dimensions shared by the renderer and component-aware layout adapter. */
export const PROJECT_NODE_SIZE = {
  compact: { width: 224, height: 56 },
  full: { width: 268, height: 96 },
} as const;

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
  /** The owning org id, used to build the card's explicit "open project" navigation link. */
  orgId: string;
  /** The project's lifecycle status (drives the leading glyph + status badge). */
  status: ProjectStatus;
  /** The project's health verdict, or `null` when unset (drives the health tint). */
  health: Health | null;
  /** Weighted completion, 0–100 (drives the full-density progress bar). */
  progress: number;
  /** How many Tasks the project holds, so the bar can state what it is measuring. */
  taskCount: number;
  /** How many of those Tasks are complete. */
  completedTaskCount: number;
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
  const {
    name,
    orgId,
    status,
    health,
    progress,
    taskCount,
    completedTaskCount,
    targetDate,
    waitingCount,
    density,
    isRoot,
  } = data as ProjectNodeData;
  const compact = density === 'compact';
  const size = PROJECT_NODE_SIZE[density];
  const resolved = useWorkStatus('project', status);
  // Low-detail (zoomed out): show just the glyph + name, dropping the badge row and progress.
  const lod = useLod();
  const showDetail = !compact && !lod;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const targetLabel = formatCalendarDate(targetDate, { month: 'short', day: 'numeric' });
  const waiting = waitingCount > 0;
  const taskReading =
    taskCount === 0
      ? 'No tasks yet'
      : `${String(completedTaskCount)} of ${String(taskCount)} tasks complete (${String(pct)}%)`;
  const href = `/orgs/${orgId}/projects/${id}`;
  const object = {
    kind: 'project' as const,
    id,
    organizationId: orgId,
    title: name,
    meta: { taskCount },
  };
  const selection = useSelectableRow(object);
  const {
    onClick: selectionClick,
    ref: selectionRef,
    ...selectionRowProps
  } = selection.rowProps;
  void selectionClick;
  const relation = useRelationDropTarget({ target: object });

  return (
    <ObjectSurface object={object} surfaceId="project-canvas" associationModifier="alt" href={href}>
      <div
        role="treeitem"
        {...selectionRowProps}
        ref={(element) => {
          selectionRef(element);
          relation.dropProps.ref(element);
        }}
        data-drop-state={relation.dropProps['data-drop-state']}
        style={{
          viewTransitionName: projectNodeTransitionName(id),
          width: size.width,
          height: size.height,
        }}
        className={cn(
          'group bg-surface-container-high relative flex flex-col justify-center gap-1.5 overflow-hidden rounded-lg transition-colors',
          compact ? 'px-3' : 'px-3.5',
          (selected || selection.selected) && 'ring-primary ring-2',
          relation.dropProps.className,
          relation.dropState === 'accept' && 'ring-primary bg-primary/8 ring-2 ring-inset',
          relation.dropState === 'reject' && 'ring-error/60 bg-error/5 ring-2 ring-inset',
        )}
      >
        {/*
        The states the border used to encode, carried by a leading accent instead: the focus of a
        neighbourhood view, and a project with upstream work still open.
      */}
        {isRoot || waiting ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0 left-0 w-1',
              isRoot ? 'bg-primary' : 'bg-state-started/70',
            )}
          />
        ) : null}
        <Handle type="target" position={Position.Left} className="!bg-outline-variant !size-2" />

        {/* Explicit navigation affordance: the card itself never navigates (too easy to mis-click
          while panning or connecting), so a deliberate corner button reveals on hover/focus. */}
        <Link
          href={href}
          aria-label={`Open ${name}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="nodrag nopan bg-surface-container-highest text-on-surface-variant hover:bg-secondary-container hover:text-on-secondary-container focus-visible:ring-ring absolute top-1 right-1 z-10 inline-flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowRight className="size-4" />
        </Link>

        <div className="flex min-w-0 items-center gap-2">
          <WorkStatusIcon name={resolved.name} category={resolved.category} />
          <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">{name}</span>
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
              <WorkStatusBadge name={resolved.name} category={resolved.category} />
              {waiting ? (
                <span className="text-state-started text-label-small shrink-0">
                  {waitingCount} waiting
                </span>
              ) : null}
              {targetLabel !== null ? (
                <span className="text-on-surface-variant text-label-small ml-auto shrink-0 tabular-nums">
                  {targetLabel}
                </span>
              ) : null}
            </div>
            {/*
            The bar and its reading are one thing. Read alone the bar encodes nothing a viewer can
            name; read together they say "3/8 tasks" and the fill is just that number drawn.
          */}
            <div className="flex min-w-0 items-center gap-2" title={taskReading}>
              <span className="text-on-surface-variant text-label-small shrink-0 tabular-nums">
                {taskCount === 0 ? 'No tasks' : `${completedTaskCount}/${taskCount} tasks`}
              </span>
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={taskReading}
                className="bg-surface-container h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </>
        ) : null}

        <Handle type="source" position={Position.Right} className="!bg-outline-variant !size-2" />
        {relation.effectLabel ? (
          <span className="bg-surface text-on-surface ring-outline-variant pointer-events-none absolute -top-7 left-1/2 z-50 -translate-x-1/2 rounded px-2 py-1 whitespace-nowrap ring-1">
            {relation.effectLabel}
          </span>
        ) : null}
      </div>
    </ObjectSurface>
  );
}

/** Memoized so unrelated graph updates don't re-render every node. */
const ProjectNode = memo(ProjectNodeComponent);
export default ProjectNode;
