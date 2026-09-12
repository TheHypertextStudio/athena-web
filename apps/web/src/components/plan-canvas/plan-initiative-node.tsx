'use client';

/**
 * `components/plan-canvas/plan-initiative-node` — the initiative card at a plan's root.
 *
 * @remarks
 * The one card on the board that is not a container, so it earns the room to read like a record:
 * identity row, the summary at body size, then who owns it and the date it lands. The leading
 * accent bar marks the root, and the corner affordance opens the real record once confirmed. Its
 * one edit affordance is the toolbar's Add project, because an initiative on this canvas is the
 * thing projects hang off.
 */
import { ActorAvatar } from '@docket/ui/components';
import { ArrowRight, Plus, Target } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { surfaceToneColor } from '@docket/ui/primitives';
import { Handle, NodeToolbar, type NodeProps, Position } from '@xyflow/react';
import { memo, type JSX } from 'react';

import Link from '@/components/docket-link';
import { formatCalendarDate } from '@/lib/format-date';

import { usePlanCanvasActions } from './plan-canvas-context';
import { PLAN_INITIATIVE_SIZE, type PlanInitiativeNodeData } from './plan-nodes';
import {
  PlanField,
  PlanStateChip,
  planCardClasses,
  planHandleClasses,
  planNodeTransitionName,
} from './plan-status';

/** The card's last line: who owns the initiative and when it lands; nothing for an unset field. */
function PlanInitiativeMeta({
  node,
  changed,
}: {
  readonly node: PlanInitiativeNodeData;
  readonly changed: ReadonlySet<string>;
}): JSX.Element | null {
  const target = formatCalendarDate(node.targetDate, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (node.owner === null && target === null) return null;
  return (
    <div className="text-on-surface-variant text-label-medium flex min-w-0 items-center gap-x-1.5">
      {node.owner !== null ? (
        <PlanField
          changed={changed.has('ownerId')}
          className="flex min-w-0 items-center gap-1 truncate"
        >
          <ActorAvatar
            kind={node.owner.kind}
            name={node.owner.name}
            avatarUrl={node.owner.avatarUrl}
            size={18}
          />
          <span className="min-w-0 truncate">{node.owner.name}</span>
        </PlanField>
      ) : null}
      {target !== null ? (
        <PlanField changed={changed.has('targetDate')} className="shrink-0 tabular-nums">
          {node.owner !== null ? '· ' : ''}
          {target}
        </PlanField>
      ) : null}
    </div>
  );
}

function PlanInitiativeNodeComponent({
  id,
  data,
  selected,
  sourcePosition,
}: NodeProps): JSX.Element {
  const node = data as PlanInitiativeNodeData;
  const actions = usePlanCanvasActions();
  const changed = new Set(node.changedFields);
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-label={`${node.title}, initiative, ${node.status === 'draft' ? 'draft' : 'created'}`}
      data-plan-ref={id}
      data-plan-kind="initiative"
      data-plan-status={node.status}
      style={{ viewTransitionName: planNodeTransitionName(id), ...PLAN_INITIATIVE_SIZE }}
      className={cn(
        surfaceToneColor('floating'),
        'group relative flex flex-col justify-center gap-1.5 overflow-hidden rounded-xl py-3 pr-3.5 pl-4',
        planCardClasses(node.status, node.entered, selected),
      )}
    >
      {node.isRoot ? (
        <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-1" />
      ) : null}
      {actions?.canEdit ? (
        <NodeToolbar position={Position.Top} offset={8}>
          <div
            className={cn(
              surfaceToneColor('canvas'),
              'border-outline-variant flex items-center gap-1 rounded-lg border p-1',
            )}
          >
            <button
              type="button"
              onClick={() => {
                actions.addProject(id);
              }}
              className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface text-label-medium inline-flex items-center gap-1 rounded px-2 py-1"
            >
              <Plus aria-hidden="true" className="size-3.5" /> Project
            </button>
          </div>
        </NodeToolbar>
      ) : null}
      {node.href !== null ? (
        <Link
          href={node.href}
          aria-label={`Open ${node.title}`}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className={cn(
            surfaceToneColor('prominent'),
            'nodrag nopan hover:bg-secondary-container hover:text-on-secondary-container focus-visible:ring-ring absolute top-1.5 right-1.5 z-10 inline-flex size-6 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <Target aria-hidden="true" className="text-primary size-4 shrink-0" />
        <PlanField
          changed={changed.has('title')}
          className="text-on-surface text-title-small min-w-0 flex-1 truncate"
        >
          {node.title}
        </PlanField>
        <PlanStateChip status={node.status} />
      </div>
      {node.summary !== null ? (
        <PlanField
          changed={changed.has('summary')}
          className="text-on-surface-variant text-body-small line-clamp-2"
        >
          {node.summary}
        </PlanField>
      ) : null}
      <PlanInitiativeMeta node={node} changed={changed} />
      <Handle
        type="source"
        position={sourcePosition ?? Position.Right}
        className={planHandleClasses('!size-2')}
      />
    </div>
  );
}

/** Memoised so unrelated plan updates do not re-render every card. */
const PlanInitiativeNode = memo(PlanInitiativeNodeComponent);
export default PlanInitiativeNode;
