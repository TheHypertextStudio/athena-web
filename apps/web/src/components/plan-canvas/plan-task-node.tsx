'use client';

/**
 * `components/plan-canvas/plan-task-node` — one task row inside its project container.
 *
 * @remarks
 * A task is the most granular thing on the board, so its row is the leanest: the title and the
 * facts a planner reads at a glance — who, which team, and when. The state glyph belongs to the
 * container and the cards above it; a row wears none. The assignee is an avatar rather than a
 * name so a long name never takes the title's room; the name rides on the avatar's label and the
 * row's accessible label. A feature task that carries subtasks leads with a chevron that folds
 * them; its subtasks sit one indent in beneath it. A draft feature task offers Add subtask on
 * hover; a subtask never does, because subtasks go one level deep. A draft row can be dragged
 * into another container; a created row stays where its real record says it is.
 */
import { ActorAvatar } from '@docket/ui/components';
import { ChevronDown, ChevronRight, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, surfaceToneColor } from '@docket/ui/primitives';
import { type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import { formatCalendarDate } from '@/lib/format-date';

import { type PlanCanvasActions, usePlanCanvasActions } from './plan-canvas-context';
import type { PlanTaskNodeData } from './plan-nodes';
import {
  PlanDependencyHandle,
  PlanField,
  planCardClasses,
  planNodeTransitionName,
} from './plan-status';

function taskLabel(node: PlanTaskNodeData): string {
  const parts = [
    node.title,
    node.depth === 0 ? 'task' : 'subtask',
    node.status === 'draft' ? 'draft' : 'created',
  ];
  if (node.assignee !== null) parts.push(`assigned to ${node.assignee.name}`);
  if (node.team !== null) parts.push(node.team);
  return parts.join(', ');
}

/**
 * A feature task is a raised row on its container; a subtask sits on the container's own tone,
 * one step quieter, and takes the raised tone only under the pointer.
 */
function rowSurface(depth: PlanTaskNodeData['depth']): string {
  if (depth === 0) return surfaceToneColor('floating');
  return 'text-on-surface hover:bg-surface-container-high transition-colors';
}

/** Props for {@link SubtaskToggle}. */
interface SubtaskToggleProps {
  readonly node: PlanTaskNodeData;
  readonly id: string;
  readonly actions: PlanCanvasActions | null;
}

/** The chevron that folds a feature task's subtasks, or a spacer that keeps titles aligned. */
function SubtaskToggle({ node, id, actions }: SubtaskToggleProps): JSX.Element | null {
  if (node.depth === 1) return <span aria-hidden="true" className="w-1 shrink-0" />;
  if (node.subtaskCount === 0 || actions === null) {
    return <span aria-hidden="true" className="size-5 shrink-0" />;
  }
  const Glyph = node.subtasksShown ? ChevronDown : ChevronRight;
  const noun = node.subtaskCount === 1 ? 'subtask' : 'subtasks';
  const label = node.subtasksShown
    ? `Hide ${String(node.subtaskCount)} ${noun}`
    : `Show ${String(node.subtaskCount)} ${noun}`;
  return (
    <button
      type="button"
      aria-expanded={node.subtasksShown}
      aria-label={label}
      title={label}
      data-testid="plan-subtask-toggle"
      className="nodrag nopan text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      onClick={(event) => {
        event.stopPropagation();
        actions.toggleSubtasks(id);
      }}
    >
      <Glyph aria-hidden="true" className="size-3.5" />
    </button>
  );
}

/** Add subtask, shown on hover of a draft feature task the viewer may edit. */
function AddSubtaskButton({ node, id, actions }: SubtaskToggleProps): JSX.Element | null {
  if (!node.canAddSubtask || actions === null) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      aria-label="Add subtask"
      title="Add subtask"
      className="nodrag nopan size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        actions.addSubtask(id);
      }}
    >
      <Plus className="size-3.5" />
    </Button>
  );
}

function PlanTaskNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as PlanTaskNodeData;
  const actions = usePlanCanvasActions();
  const changed = new Set(node.changedFields);
  const due = formatCalendarDate(node.dueDate, { month: 'short', day: 'numeric' });
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-level={node.depth + 1}
      aria-label={taskLabel(node)}
      data-plan-ref={id}
      data-plan-kind="task"
      data-plan-depth={node.depth}
      data-plan-status={node.status}
      style={{ viewTransitionName: planNodeTransitionName(id) }}
      className={cn(
        rowSurface(node.depth),
        'group relative flex size-full items-center gap-1.5 rounded-md pr-2 pl-1',
        planCardClasses(node.entered, selected),
      )}
    >
      <PlanDependencyHandle id="dep-in" type="target" position={Position.Top} size="!size-1.5" />
      <SubtaskToggle node={node} id={id} actions={actions} />
      <PlanField
        changed={changed.has('title')}
        className="text-on-surface text-body-small min-w-0 flex-1 truncate"
      >
        {node.title}
      </PlanField>
      <AddSubtaskButton node={node} id={id} actions={actions} />
      {node.team !== null ? (
        <PlanField
          changed={changed.has('teamId')}
          className="text-on-surface-variant text-label-small max-w-24 shrink-0 truncate"
        >
          {node.team}
        </PlanField>
      ) : null}
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
