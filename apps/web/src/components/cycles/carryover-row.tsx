'use client';

/**
 * One incomplete-task row in the close-cycle carryover review.
 *
 * @remarks
 * When a cycle closes, every still-open committed task needs a decision before it rolls
 * (product §8.5 — "carryover is reviewed before it rolls, nothing moves by accident"). This
 * row presents that decision for a single task: its status glyph + title, then a styled
 * action control choosing **keep** (leave on the closed cycle), **move** (to a chosen next
 * cycle), or **triage** (detach to the team's triage queue). Picking "move" reveals a second
 * styled picker for the destination cycle; until one is chosen the row reads as incomplete so
 * the dialog can block the close. Both controls are `@docket/ui` DropdownMenus — never bare
 * `<select>`s — with focus rings and keyboard operation.
 */
import type { CycleCarryoverAction } from '@docket/types';
import { StatusIcon, type WorkflowStateType } from '@docket/ui/components';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** A destination cycle a carryover task can be moved to. */
export interface CarryoverTarget {
  /** The target cycle id. */
  readonly id: string;
  /** A human label for the target (e.g. "Cycle 7 · Jun 22 – Jul 5"). */
  readonly label: string;
}

/** A single incomplete task and the decision currently chosen for it. */
export interface CarryoverItem {
  /** The task id. */
  readonly taskId: string;
  /** The task title. */
  readonly title: string;
  /** The task's canonical workflow-state type (for the leading glyph). */
  readonly stateType: WorkflowStateType;
  /** The chosen carryover action. */
  readonly action: CycleCarryoverAction;
  /** The chosen destination cycle id, when the action is `move`. */
  readonly targetCycleId: string | null;
}

/** Props for {@link CarryoverRow}. */
export interface CarryoverRowProps {
  /** The task + its current decision. */
  item: CarryoverItem;
  /** The cycles this task may be moved into (other open cycles on the same team). */
  targets: readonly CarryoverTarget[];
  /** Change the chosen action for this task. */
  onActionChange: (action: CycleCarryoverAction) => void;
  /** Change the chosen destination cycle for this task. */
  onTargetChange: (targetCycleId: string) => void;
}

/** Ordered action options with their labels (drives the menu + the trigger label). */
const ACTION_OPTIONS: readonly { value: CycleCarryoverAction; label: string }[] = [
  { value: 'move', label: 'Move to next' },
  { value: 'keep', label: 'Keep here' },
  { value: 'triage', label: 'Return to triage' },
];

/** Resolve an action to its human label (used by the trigger). */
function actionLabel(action: CycleCarryoverAction): string {
  return ACTION_OPTIONS.find((option) => option.value === action)?.label ?? 'Keep here';
}

/**
 * A carryover decision row for one incomplete task.
 *
 * @example
 * ```tsx
 * <CarryoverRow item={item} targets={targets} onActionChange={…} onTargetChange={…} />
 * ```
 */
export function CarryoverRow({
  item,
  targets,
  onActionChange,
  onTargetChange,
}: CarryoverRowProps): JSX.Element {
  const needsTarget = item.action === 'move';
  const targetLabel = item.targetCycleId
    ? (targets.find((t) => t.id === item.targetCycleId)?.label ?? 'Choose a cycle')
    : 'Choose a cycle';
  const noTargets = targets.length === 0;

  return (
    <div className="border-outline-variant flex flex-wrap items-center gap-3 border-b py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <StatusIcon type={item.stateType} className="shrink-0" />
        <span className="text-on-surface text-body truncate">{item.title}</span>
      </span>

      {/* Action picker. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <span>{actionLabel(item.action)}</span>
            <ChevronDown className="h-4 w-4 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuRadioGroup
            value={item.action}
            onValueChange={(next) => {
              onActionChange(next as CycleCarryoverAction);
            }}
          >
            {ACTION_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                disabled={option.value === 'move' && noTargets}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Destination picker — only when moving. */}
      {needsTarget ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={noTargets}
              className={cn('gap-1.5', !item.targetCycleId && 'text-on-surface-variant')}
            >
              <span>{noTargets ? 'No cycle to move to' : targetLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            <DropdownMenuRadioGroup value={item.targetCycleId ?? ''} onValueChange={onTargetChange}>
              {targets.map((target) => (
                <DropdownMenuRadioItem key={target.id} value={target.id}>
                  {target.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
