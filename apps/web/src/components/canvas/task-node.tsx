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
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';

import { PriorityGlyph } from '@/components/task-detail/PriorityGlyph';
import { stateTypeOf } from '@/lib/work-state';

import { taskNodeTransitionName } from './transition-name';

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
  /** The owning project id, or null (used by the toolbar's project filter). */
  projectId: string | null;
  /** The owning project's display name, resolved for the chip, or null. */
  projectName: string | null;
  /** The raw assignee actor id, or null (used by the toolbar's assignee filter). */
  assigneeId: string | null;
  /** The resolved assignee, or null when unassigned/unknown. */
  assignee: ResolvedAssignee | null;
  /** Has an incomplete blocker (open `blocking → this` dependency). */
  isBlocked: boolean;
  /** Blockers all complete and not yet started — actionable now. */
  isReady: boolean;
  /** The canvas density, threaded through so the node sizes to its host. */
  density: 'compact' | 'full';
  /** Whether this node is the focus/root of a neighborhood view. */
  isRoot?: boolean;
}

/** A single task card on the canvas. */
function TaskNodeComponent({ id, data, selected }: NodeProps): React.JSX.Element {
  const { title, state, priority, projectName, assignee, isBlocked, isReady, density, isRoot } =
    data as TaskNodeData;
  const compact = density === 'compact';
  return (
    <div
      style={{ viewTransitionName: taskNodeTransitionName(id) }}
      className={cn(
        'group bg-surface-container relative flex items-center gap-2 rounded-lg border shadow-sm transition-colors',
        compact ? 'h-11 w-[208px] pr-2 pl-2.5' : 'h-[68px] w-[248px] pr-2.5 pl-3',
        isRoot
          ? 'border-primary'
          : isBlocked
            ? 'border-state-started/60'
            : 'border-outline-variant',
        selected && 'ring-primary ring-2',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-outline-variant !bg-surface !size-2"
      />

      <StatusIcon type={stateTypeOf(state)} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-on-surface text-body truncate font-medium">{title}</span>
        {!compact ? (
          <div className="text-on-surface-variant flex min-w-0 items-center gap-1.5 text-xs">
            {projectName !== null ? (
              <span className="bg-surface-container-high max-w-[7rem] truncate rounded px-1.5 py-0.5">
                {projectName}
              </span>
            ) : null}
            {isBlocked ? (
              <span className="text-state-started font-medium">Blocked</span>
            ) : isReady ? (
              <span className="text-primary font-medium">Ready</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {priority !== 'none' ? <PriorityGlyph priority={priority} /> : null}
        {assignee !== null ? (
          <ActorAvatar
            kind={assignee.kind}
            name={assignee.name}
            avatarUrl={assignee.avatarUrl}
            size={compact ? 18 : 22}
          />
        ) : null}
      </div>

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
