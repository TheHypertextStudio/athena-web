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
import type { Priority } from '@docket/types';
import { type ActorKind, ActorAvatar, StatusIcon } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { Handle, type NodeProps, NodeToolbar, Position } from '@xyflow/react';
import { memo } from 'react';

import { formatCalendarDate } from '@/lib/format-date';
import { stateTypeOf } from '@/lib/work-state';

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
  /** The task title. */
  title: string;
  /** The free-form workflow-state key (mapped to a canonical type for the glyph). */
  state: string;
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
  const { title, state, projectName, assignee, isBlocked, isReady, dueDate, density } =
    data as TaskNodeData;
  const compact = density === 'compact';
  const done = stateTypeOf(state) === 'completed' || stateTypeOf(state) === 'canceled';
  const overdue = !done && isOverdue(dueDate);
  const dueLabel = formatCalendarDate(dueDate, { month: 'short', day: 'numeric' });
  const actions = useCanvasActions();
  // Low-detail (zoomed out): show just the glyph + title, dropping the meta row and trailing cluster.
  const lod = useLod();
  const showDetail = !compact && !lod;
  return (
    <div
      style={{ viewTransitionName: taskNodeTransitionName(id) }}
      className={cn(
        'group bg-surface-container-high border-outline-variant relative flex items-start gap-2.5 rounded-xl border transition-colors',
        compact ? 'h-14 w-[240px] px-2.5 py-2' : 'h-[84px] w-[300px] px-3 py-2.5',
        selected && 'ring-primary ring-2',
      )}
    >
      {actions !== null ? (
        <NodeToolbar position={Position.Top} offset={8}>
          <div className="border-outline-variant bg-surface-container flex items-center gap-1 rounded-lg border p-1 shadow-md">
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
                    actions.setState(id, done ? 'todo' : 'done');
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

      <StatusIcon type={stateTypeOf(state)} className="mt-0.5 shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-on-surface text-body-medium line-clamp-2 leading-snug font-medium break-words">
          {title}
        </span>
        {showDetail ? (
          <div className="text-on-surface-variant flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {projectName !== null ? <span className="min-w-0 truncate">{projectName}</span> : null}
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
    </div>
  );
}

/** Memoized so unrelated graph updates don't re-render every node. */
const TaskNode = memo(TaskNodeComponent);
export default TaskNode;
