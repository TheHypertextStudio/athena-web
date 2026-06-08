'use client';

/**
 * The close-cycle carryover review dialog.
 *
 * @remarks
 * Closing a cycle is a deliberate, reviewed step (product §8.5): nothing rolls by accident.
 * This modal lists every still-incomplete committed task and asks, per task, what should
 * happen to it — keep on the (now-closed) cycle, move it to a chosen next cycle, or return it
 * to the team's triage queue ({@link CarryoverRow}). A summary line tallies the chosen
 * decisions; the confirm button stays disabled until every "move" has a destination, so the
 * `…/cycles/:id/close` call never fails validation. A cycle with nothing open skips straight
 * to a one-click confirm.
 *
 * The dialog is built on the shared {@link Dialog} primitive (Radix-backed), so the
 * accessibility hard parts — `role="dialog"` + `aria-modal`, focus trap, Escape-to-dismiss,
 * click-outside close, scroll-lock, return-focus, and the `aria-labelledby`/`aria-describedby`
 * wiring — come for free; this component only supplies the carryover body, the summary, and the
 * Cancel / Close actions. All chrome uses `@docket/ui` primitives and semantic tokens — no bare
 * HTML controls, no hardcoded color.
 */
import type { CycleCarryoverAction } from '@docket/types';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX } from 'react';

import { type CarryoverItem, CarryoverRow, type CarryoverTarget } from './carryover-row';

/** Props for {@link CloseCycleDialog}. */
export interface CloseCycleDialogProps {
  /** Whether the dialog is open (the host page owns this state). */
  open: boolean;
  /** Notify the parent that the open state changed (Esc, backdrop, X, or Cancel). */
  onOpenChange: (open: boolean) => void;
  /** The cycle's display name (for the dialog title). */
  cycleName: string;
  /** The (vocabulary-resolved) singular cycle noun, lowercased for inline copy. */
  cycleNoun: string;
  /** The still-incomplete tasks, each with its current carryover decision. */
  items: readonly CarryoverItem[];
  /** The cycles a carryover task may be moved into. */
  targets: readonly CarryoverTarget[];
  /** Whether the close request is in flight. */
  closing: boolean;
  /** A close error to surface, if any. */
  closeError: string | null;
  /** Change a task's chosen action. */
  onActionChange: (taskId: string, action: CycleCarryoverAction) => void;
  /** Change a task's chosen destination cycle. */
  onTargetChange: (taskId: string, targetCycleId: string) => void;
  /** Confirm the close (submit the carryover decisions). */
  onConfirm: () => void;
}

/** Tally the chosen decisions into a short human summary. */
function summarize(items: readonly CarryoverItem[]): string {
  let kept = 0;
  let moved = 0;
  let triaged = 0;
  for (const item of items) {
    if (item.action === 'keep') kept += 1;
    else if (item.action === 'move') moved += 1;
    else triaged += 1;
  }
  const parts: string[] = [];
  if (moved > 0) parts.push(`${String(moved)} moving`);
  if (kept > 0) parts.push(`${String(kept)} kept`);
  if (triaged > 0) parts.push(`${String(triaged)} to triage`);
  return parts.join(' · ');
}

/**
 * The reviewed carryover modal shown when closing a cycle.
 *
 * @example
 * ```tsx
 * <CloseCycleDialog open={open} onOpenChange={setOpen} cycleName="Cycle 6" cycleNoun="cycle" … />
 * ```
 */
export function CloseCycleDialog({
  open,
  onOpenChange,
  cycleName,
  cycleNoun,
  items,
  targets,
  closing,
  closeError,
  onActionChange,
  onTargetChange,
  onConfirm,
}: CloseCycleDialogProps): JSX.Element {
  const everyMoveHasTarget = items.every(
    (item) => item.action !== 'move' || item.targetCycleId !== null,
  );
  const summary = summarize(items);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A close in flight must not be interrupted by Esc/backdrop/X.
        if (closing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-0 p-0">
        <DialogHeader className="border-outline-variant gap-1 border-b px-5 py-4 pr-12">
          <DialogTitle>Close {cycleName}</DialogTitle>
          <DialogDescription>
            {items.length === 0
              ? `Everything committed to this ${cycleNoun} is complete — nothing to carry over.`
              : `Review what happens to ${String(items.length)} open ${
                  items.length === 1 ? 'task' : 'tasks'
                } before this ${cycleNoun} rolls.`}
          </DialogDescription>
        </DialogHeader>

        {items.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
            {items.map((item) => (
              <CarryoverRow
                key={item.taskId}
                item={item}
                targets={targets}
                onActionChange={(action) => {
                  onActionChange(item.taskId, action);
                }}
                onTargetChange={(targetCycleId) => {
                  onTargetChange(item.taskId, targetCycleId);
                }}
              />
            ))}
          </div>
        ) : null}

        {closeError ? (
          <p role="alert" className="text-destructive px-5 pt-3 text-sm">
            {closeError}
          </p>
        ) : null}

        <DialogFooter className="border-outline-variant items-center justify-between border-t px-5 py-4 sm:justify-between">
          <span className="text-muted-foreground text-xs">
            {items.length === 0 ? 'Ready to close' : summary}
          </span>
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm" disabled={closing}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={closing || !everyMoveHasTarget}
              className={cn(!everyMoveHasTarget && 'cursor-not-allowed')}
            >
              {closing ? 'Closing…' : `Close ${cycleNoun}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
