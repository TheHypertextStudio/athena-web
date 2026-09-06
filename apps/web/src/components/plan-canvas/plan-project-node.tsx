'use client';

/**
 * `components/plan-canvas/plan-project-node` — a project as a container of its task rows.
 *
 * @remarks
 * Built on the Task graph's swimlane container: a hairline lane with a header band, sized by the
 * layout to the rows it holds, drawn beneath them. The header carries what a person reads to know
 * which project this is — glyph, name, lead, target, count — and the initiatives it also belongs
 * to, which is how the many-to-many relationship stays visible without a second frame.
 */
import { ArrowRight, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import Link from '@/components/docket-link';
import { formatCalendarDate } from '@/lib/format-date';

import { usePlanCanvasActions } from './plan-canvas-context';
import { PLAN_PROJECT_FOOTER, PLAN_PROJECT_HEADER, type PlanProjectNodeData } from './plan-nodes';
import {
  PlanCreatedMark,
  PlanDraftPill,
  PlanField,
  PlanStatusGlyph,
  planCardClasses,
  planNodeTransitionName,
} from './plan-status';

/** How many "also in" initiatives are named before the rest collapse into a count. */
const ALSO_IN_SHOWN = 2;

function PlanProjectNodeComponent({ id, data, selected }: NodeProps): JSX.Element {
  const node = data as PlanProjectNodeData;
  const actions = usePlanCanvasActions();
  const changed = new Set(node.changedFields);
  const target = formatCalendarDate(node.targetDate, { month: 'short', year: 'numeric' });
  const count = `${String(node.taskCount)} ${node.taskCount === 1 ? 'task' : 'tasks'}`;
  const shown = node.alsoIn.slice(0, ALSO_IN_SHOWN);
  const more = node.alsoIn.length - shown.length;
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
        type="target"
        position={Position.Left}
        style={{ top: PLAN_PROJECT_HEADER / 2 }}
        className="!bg-outline-variant !size-2"
      />
      <div
        style={{ height: PLAN_PROJECT_HEADER }}
        className="flex flex-col justify-center gap-1 px-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <PlanStatusGlyph status={node.status} />
          <PlanField
            changed={changed.has('title')}
            className="text-on-surface text-label-large min-w-0 flex-1 truncate"
          >
            {node.title}
          </PlanField>
          {node.status === 'draft' ? <PlanDraftPill /> : <PlanCreatedMark />}
          {node.href !== null ? (
            <Link
              href={node.href}
              aria-label={`Open ${node.title}`}
              onClick={(event) => {
                event.stopPropagation();
              }}
              className={cn(
                surfaceToneColor('prominent'),
                'nodrag nopan hover:bg-secondary-container hover:text-on-secondary-container focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </div>
        <div className="text-on-surface-variant text-label-medium flex min-w-0 items-center gap-x-2">
          <PlanField changed={changed.has('leadId')} className="min-w-0 truncate">
            {node.leadName ?? 'No lead yet'}
          </PlanField>
          {target !== null ? (
            <PlanField changed={changed.has('targetDate')} className="shrink-0">
              · {target}
            </PlanField>
          ) : null}
          <span className="shrink-0">· {count}</span>
        </div>
        {shown.length > 0 ? (
          <div className="text-on-surface-variant text-label-small flex min-w-0 items-center gap-1">
            <span className="shrink-0">Also in</span>
            {shown.map((name) => (
              <span
                key={name}
                className="bg-surface-container-high text-on-surface-variant min-w-0 truncate rounded-full px-1.5 py-px"
              >
                {name}
              </span>
            ))}
            {more > 0 ? <span className="shrink-0">+{more}</span> : null}
          </div>
        ) : null}
      </div>
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
      <Handle
        type="source"
        position={Position.Right}
        style={{ top: PLAN_PROJECT_HEADER / 2 }}
        className="!bg-outline-variant !size-2"
      />
    </div>
  );
}

/** Memoised so a task row edit does not re-render every container. */
const PlanProjectNode = memo(PlanProjectNodeComponent);
export default PlanProjectNode;
