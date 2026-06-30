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
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { StatusIcon } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { memo } from 'react';

import { stateTypeOf } from '@/lib/work-state';
import { taskNodeTransitionName } from './transition-name';

/** The data a {@link TaskNode} renders; lives on the xyflow node's `data`. */
export interface TaskNodeData extends Record<string, unknown> {
  /** The task title. */
  title: string;
  /** The free-form workflow-state key (mapped to a canonical type for the glyph). */
  state: string;
  /** The canvas density, threaded through so the node sizes to its host. */
  density: 'compact' | 'full';
  /** Whether this node is the focus/root of a neighborhood view. */
  isRoot?: boolean;
}

/** A single task card on the canvas. */
function TaskNodeComponent({ id, data, selected }: NodeProps): React.JSX.Element {
  const { title, state, density, isRoot } = data as TaskNodeData;
  const compact = density === 'compact';
  return (
    <div
      style={{ viewTransitionName: taskNodeTransitionName(id) }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-surface-container px-3 shadow-sm transition-colors',
        compact ? 'h-11 w-[184px]' : 'h-16 w-[224px]',
        isRoot ? 'border-primary' : 'border-outline-variant',
        selected && 'ring-2 ring-primary',
      )}
    >
      <Handle type="target" position={Position.Left} className="!border-outline-variant !bg-surface" />
      <StatusIcon type={stateTypeOf(state)} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-on-surface text-body font-medium">{title}</span>
        {!compact ? (
          <span className="truncate text-on-surface-variant text-xs capitalize">
            {state.replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!border-outline-variant !bg-surface" />
    </div>
  );
}

/** Memoized so unrelated graph updates don't re-render every node. */
const TaskNode = memo(TaskNodeComponent);
export default TaskNode;
