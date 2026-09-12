'use client';

/**
 * `components/plan-canvas/plan-project-node` — a project as a container of its task rows.
 *
 * @remarks
 * Built on the Task graph's swimlane container: a hairline lane with a header band, sized by the
 * layout to the rows it holds, drawn beneath them. The header (see `plan-project-header`) carries
 * what a person reads to know which project this is, and the initiatives it also belongs to, which
 * is how the many-to-many relationship stays visible without a second frame. Membership links land
 * on the quiet handles; dependencies are drawn from the named ones.
 */
import { Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import { usePlanCanvasActions } from './plan-canvas-context';
import {
  PLAN_PROJECT_FOOTER,
  PLAN_PROJECT_HEADER,
  PLAN_PROJECT_PADDING,
  type PlanProjectNodeData,
} from './plan-nodes';
import { PlanProjectHeader } from './plan-project-header';
import {
  PlanDependencyHandle,
  planCardClasses,
  planHandleClasses,
  planNodeTransitionName,
} from './plan-status';

function PlanProjectNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as PlanProjectNodeData;
  const actions = usePlanCanvasActions();
  const changed = new Set(node.changedFields);
  const count = `${String(node.taskCount)} ${node.taskCount === 1 ? 'task' : 'tasks'}`;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-label={`${node.title}, project, ${node.status === 'draft' ? 'draft' : 'created'}, ${count}`}
      data-plan-ref={id}
      data-plan-kind="project"
      data-plan-status={node.status}
      style={{ viewTransitionName: planNodeTransitionName(id) }}
      className={cn(
        surfaceToneColor('card'),
        'group relative size-full rounded-xl',
        node.status === 'confirmed' && 'border-outline-variant border',
        planCardClasses(node.status, node.entered, selected),
      )}
    >
      <Handle
        id="link"
        type="target"
        position={Position.Left}
        style={{ top: PLAN_PROJECT_HEADER / 2 }}
        className={planHandleClasses('!size-2')}
      />
      <Handle
        id="link-top"
        type="target"
        position={Position.Top}
        style={{ left: PLAN_PROJECT_PADDING * 2 }}
        className={planHandleClasses('!size-2')}
      />
      <PlanDependencyHandle id="dep-in" type="target" position={Position.Top} size="!size-2" />
      <PlanProjectHeader node={node} changed={changed} />
      {node.canAddTask && actions !== null ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            actions.addTask(id);
          }}
          style={{ height: PLAN_PROJECT_FOOTER }}
          className="nodrag nopan text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring text-label-medium absolute right-3 bottom-2 left-3 inline-flex items-center gap-1.5 rounded-lg px-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Plus aria-hidden="true" className="size-3.5" /> Add task
        </button>
      ) : null}
      <PlanDependencyHandle id="dep-out" type="source" position={Position.Bottom} size="!size-2" />
    </div>
  );
}

/** Memoised so a task row edit does not re-render every container. */
const PlanProjectNode = memo(PlanProjectNodeComponent);
export default PlanProjectNode;
