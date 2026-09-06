'use client';

/**
 * `components/plan-canvas/plan-task-node` — one task row inside its project container.
 *
 * @remarks
 * The Task graph's card at a row's proportions: glyph, title, and the two facts a planner reads
 * at a glance, who and when. A draft row can be dragged into another container; a created row
 * stays where its real record says it is.
 */
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import type { PlanTaskNodeData } from './plan-nodes';
import { PlanField, PlanStatusGlyph, planCardClasses, planNodeTransitionName } from './plan-status';

function PlanTaskNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as PlanTaskNodeData;
  const changed = new Set(node.changedFields);
  const due = formatCalendarDate(node.dueDate, { month: 'short', day: 'numeric' });
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-label={`${node.title}, task, ${node.status === 'draft' ? 'draft' : 'created'}`}
      data-plan-ref={id}
      data-plan-kind="task"
      data-plan-status={node.status}
      style={{ viewTransitionName: planNodeTransitionName(id) }}
      className={cn(
        surfaceToneColor('floating'),
        'relative flex size-full items-center gap-2 rounded-lg px-2.5',
        planCardClasses(node.status, node.entered, selected),
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-outline-variant !size-1.5" />
      <PlanStatusGlyph status={node.status} className="size-3.5" />
      <PlanField
        changed={changed.has('title')}
        className="text-on-surface text-body-small min-w-0 flex-1 truncate"
      >
        {node.title}
      </PlanField>
      {node.assigneeName !== null ? (
        <PlanField
          changed={changed.has('assigneeId')}
          className="text-on-surface-variant text-label-small shrink-0 truncate"
        >
          {node.assigneeName}
        </PlanField>
      ) : null}
      {due !== null ? (
        <PlanField
          changed={changed.has('dueDate')}
          className="text-on-surface-variant text-label-small shrink-0"
        >
          {due}
        </PlanField>
      ) : null}
      <Handle type="source" position={Position.Right} className="!bg-outline-variant !size-1.5" />
    </div>
  );
}

/** Memoised so a container edit does not re-render every row. */
const PlanTaskNode = memo(PlanTaskNodeComponent);
export default PlanTaskNode;
