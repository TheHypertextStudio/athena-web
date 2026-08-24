'use client';

/**
 * `components/canvas/task-node` — the default node renderer for the dependency canvas.
 *
 * @remarks
 * A compact card: workflow-state glyph + title (+ a muted state label at full density). All
 * color comes from the Material-3 surface/`--color-state-*` design tokens — never hardcoded —
 * matching the {@link "@docket/ui"#StatusIcon} discipline used across lists. The card carries a
 * stable `view-transition-name` (`task-node-<id>`) so that filtering, relayout, or expanding
 * the canvas morphs the same node between arrangements rather than hard-swapping it.
 */
import type { WorkStatusCategory } from '@docket/types';
import type { Priority } from '@docket/work/task-contract';
import { type ActorKind, ActorAvatar, StatusIcon } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { Handle, type NodeProps, NodeToolbar, Position } from '@xyflow/react';
import { memo } from 'react';

import { formatCalendarDate } from '@/lib/format-date';
import { isEnded } from '@/lib/work-category';

import { ObjectSurface } from '@/components/objects/object-surface';
import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';

import { useCanvasActions } from './canvas-actions-context';
import { taskNodeTransitionName } from './transition-name';
import { useLod } from './use-lod';

/** Whether an ISO `dueDate` is in the past relative to now (start of today). */
function isOverdue(dueDate: string | null): boolean {
  if (dueDate === null) return false;
  const due = new Date(dueDate).getTime();
  return Number.isFinite(due) && due < Date.now();
}

/** A node's assignee, resolved from the org's members/agents for display. */
export interface ResolvedAssignee {
  /** Display name. */
  name: string;
  /** Actor kind (avatar shape). */
  kind: ActorKind;
  /** Avatar image URL, if any. */
  avatarUrl?: string | null;
}

/** The data a {@link TaskNode} renders; lives on the xyflow node's `data`. */
export interface TaskNodeData extends Record<string, unknown> {
  /** The owning workspace, so the card can name itself as a core object for the right-click menu. */
  orgId: string;
  /** The task title. */
  title: string;
  /** The workspace's status key for this task, which is what a write sends back. */
  state: string;
  /**
   * The category that status behaves as, resolved once when the graph is mapped.
   *
   * @remarks
   * Carried on the node rather than derived from {@link TaskNodeData.state} here, because a key
   * only means something against the workspace's set — and the card, the minimap, the peek, and
   * the filter catalog would otherwise each need that set in hand.
   */
  stateType: WorkStatusCategory;
  /** The workspace's name for that status, which is what the glyph announces. */
  statusName: string;
  /** The task priority (drives the {@link PriorityGlyph}). */
  priority: Priority;
  /** The owning project id, or null (used by the toolbar's project filter + grouping). */
  projectId: string | null;
  /** The owning project's display name, resolved for the chip, or null. */
  projectName: string | null;
  /** The owning team id (used by the group-by control). */
  teamId: string;
  /** The owning milestone id, or null (used by the group-by control). */
  milestoneId: string | null;
  /** Hierarchy parent, independent from dependency edges. */
  parentTaskId: string | null;
  /** The raw assignee actor id, or null (used by the toolbar's assignee filter). */
  assigneeId: string | null;
  /** The resolved assignee, or null when unassigned/unknown. */
  assignee: ResolvedAssignee | null;
  /** Has an incomplete blocker (open `blocking → this` dependency). */
  isBlocked: boolean;
  /** Blockers all complete and not yet started — actionable now. */
  isReady: boolean;
  /** ISO due date, or null (drives the due line + overdue styling). */
  dueDate: string | null;
  /** On the longest (critical) dependency path. */
  onCriticalPath: boolean;
  /** Transitively blocks a lot of downstream work (a bottleneck). */
  isBottleneck: boolean;
  /** The canvas density, threaded through so the node sizes to its host. */
  density: 'compact' | 'full';
  /** Whether this node is the focus/root of a neighborhood view. */
  isRoot?: boolean;
}

/** Read the typed {@link TaskNodeData} off an xyflow node (one place for the `data` cast). */
export function taskData(node: { data: unknown }): TaskNodeData {
  return node.data as TaskNodeData;
}

/** A single task card on the canvas. */
function TaskNodeComponent({ id, data, selected }: NodeProps): React.JSX.Element {
  const {
    title,
    state,
    stateType,
    statusName,
    projectName,
    assignee,
    isBlocked,
    isReady,
    dueDate,
    density,
    orgId,
    parentTaskId,
  } = data as TaskNodeData;
  const compact = density === 'compact';
  const done = isEnded(stateType);
  const overdue = !done && isOverdue(dueDate);
  const dueLabel = formatCalendarDate(dueDate, { month: 'short', day: 'numeric' });
  const actions = useCanvasActions();
  // Low-detail (zoomed out): show just the glyph + title, dropping the meta row and trailing cluster.
  const lod = useLod();
  const showDetail = !compact && !lod;
  const object = {
    kind: 'task' as const,
    id,
    organizationId: orgId,
    title,
    meta: { state, parentTaskId },
  };
  const relation = useRelationDropTarget({ target: object });
  return (
    <ObjectSurface
      object={object}
      surfaceId="task-canvas"
      associationModifier="alt"
      onActivate={() => actions?.navigate(id)}
    >
      <div
        ref={relation.dropProps.ref}
        tabIndex={0}
        data-drop-state={relation.dropProps['data-drop-state']}
        style={{ viewTransitionName: taskNodeTransitionName(id) }}
        className={cn(
          'task-branch-header group bg-surface-container-high border-outline-variant relative flex items-start gap-2.5 rounded-xl border transition-colors',
          compact ? 'h-14 w-[240px] px-2.5 py-2' : 'h-[84px] w-[300px] px-3 py-2.5',
          selected && 'ring-primary ring-2',
          relation.dropProps.className,
          relation.dropState === 'accept' && 'ring-primary bg-primary/8 ring-2 ring-inset',
          relation.dropState === 'reject' && 'ring-error/60 bg-error/5 ring-2 ring-inset',
        )}
      >
        {actions !== null ? (
          <NodeToolbar position={Position.Top} offset={8}>
            <div className="border-outline-variant bg-surface-container flex items-center gap-1 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => {
                  actions.navigate(id);
                }}
                className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface rounded px-2 py-1 text-xs"
              >
                Open
              </button>
              {actions.canEdit ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      actions.setComplete(id, !done);
                    }}
                    className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface rounded px-2 py-1 text-xs"
                  >
                    {done ? 'Reopen' : 'Done'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      actions.createSubtask(id, 'New subtask');
                    }}
                    className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface rounded px-2 py-1 text-xs"
                  >
                    + Subtask
                  </button>
                </>
              ) : null}
            </div>
          </NodeToolbar>
        ) : null}

        <Handle
          type="target"
          position={Position.Left}
          className="!border-outline-variant !bg-surface !size-2"
        />

        <StatusIcon type={stateType} label={statusName} className="mt-0.5 shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-on-surface text-body-medium line-clamp-2 leading-snug font-medium break-words">
            {title}
          </span>
          {showDetail ? (
            <div className="text-on-surface-variant flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {projectName !== null ? (
                <span className="min-w-0 truncate">{projectName}</span>
              ) : null}
              {dueLabel !== null ? (
                <span className={cn('shrink-0', overdue && 'text-state-canceled font-medium')}>
                  {dueLabel}
                </span>
              ) : null}
              {isBlocked ? (
                <span className="text-state-started shrink-0 font-medium">Blocked</span>
              ) : isReady ? (
                <span className="text-primary shrink-0 font-medium">Ready</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {!lod && assignee !== null ? (
          <ActorAvatar
            kind={assignee.kind}
            name={assignee.name}
            avatarUrl={assignee.avatarUrl}
            size={compact ? 18 : 22}
            className="mt-0.5 shrink-0"
          />
        ) : null}

        <Handle
          type="source"
          position={Position.Right}
          className="!border-outline-variant !bg-surface !size-2"
        />
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
const TaskNode = memo(TaskNodeComponent);
export default TaskNode;
