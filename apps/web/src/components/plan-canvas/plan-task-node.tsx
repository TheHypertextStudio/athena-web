'use client';

/**
 * `components/plan-canvas/plan-task-node` — one task row inside its project container.
 *
 * @remarks
 * The Task graph's card at a row's proportions: glyph, title, and the two facts a planner reads
 * at a glance, who and when. The assignee is an avatar rather than a name so a long name never
 * takes the title's room; the name rides on the avatar and the row's accessible label. A draft
 * row can be dragged into another container; a created row stays where its real record says it is.
 */
import { ActorAvatar } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import type { PlanTaskNodeData } from './plan-nodes';
import {
  PlanDependencyHandle,
  PlanField,
  PlanStatusGlyph,
  planCardClasses,
  planNodeTransitionName,
} from './plan-status';

function taskLabel(node: PlanTaskNodeData): string {
  const parts = [node.title, 'task', node.status === 'draft' ? 'draft' : 'created'];
  if (node.assignee !== null) parts.push(`assigned to ${node.assignee.name}`);
  return parts.join(', ');
}

function PlanTaskNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as PlanTaskNodeData;
  const changed = new Set(node.changedFields);
  const due = formatCalendarDate(node.dueDate, { month: 'short', day: 'numeric' });
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-label={taskLabel(node)}
      data-plan-ref={id}
      data-plan-kind="task"
      data-plan-status={node.status}
      style={{ viewTransitionName: planNodeTransitionName(id) }}
      className={cn(
        surfaceToneColor('floating'),
        'group relative flex size-full items-center gap-2 rounded-md px-2.5',
        planCardClasses(node.status, node.entered, selected, 'row'),
      )}
    >
      <PlanDependencyHandle id="dep-in" type="target" position={Position.Top} size="!size-1.5" />
      <PlanStatusGlyph status={node.status} className="size-3.5" />
      <PlanField
        changed={changed.has('title')}
        className="text-on-surface text-body-small min-w-0 flex-1 truncate"
      >
        {node.title}
      </PlanField>
      {node.assignee !== null ? (
        <PlanField changed={changed.has('assigneeId')} className="inline-flex shrink-0">
          <ActorAvatar
            kind={node.assignee.kind}
            name={node.assignee.name}
            avatarUrl={node.assignee.avatarUrl}
            size={18}
          />
        </PlanField>
      ) : null}
      {due !== null ? (
        <PlanField
          changed={changed.has('dueDate')}
          className="text-on-surface-variant text-label-small shrink-0 text-right tabular-nums"
        >
          {due}
        </PlanField>
      ) : null}
      <PlanDependencyHandle
        id="dep-out"
        type="source"
        position={Position.Bottom}
        size="!size-1.5"
      />
    </div>
  );
}

/** Memoised so a container edit does not re-render every row. */
const PlanTaskNode = memo(PlanTaskNodeComponent);
export default PlanTaskNode;
