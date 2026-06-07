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
 * The dialog is a self-contained, accessible overlay rendered through a portal: `role="dialog"`
 * + `aria-modal`, an initial-focus target, Escape-to-dismiss, a focus trap, and a click-outside
 * close. All chrome uses `@docket/ui` primitives and semantic tokens — no bare HTML controls,
 * no hardcoded color.
 */
import type { CycleCarryoverAction } from '@docket/types';
import { X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, type KeyboardEvent, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { type CarryoverItem, CarryoverRow, type CarryoverTarget } from './carryover-row';

/** Props for {@link CloseCycleDialog}. */
export interface CloseCycleDialogProps {
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
  /** Dismiss the dialog without closing the cycle. */
  onCancel: () => void;
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
 * <CloseCycleDialog cycleName="Cycle 6" cycleNoun="cycle" items={items} targets={targets} … />
 * ```
 */
export function CloseCycleDialog({
  cycleName,
  cycleNoun,
  items,
  targets,
  closing,
  closeError,
  onActionChange,
  onTargetChange,
  onConfirm,
  onCancel,
}: CloseCycleDialogProps): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Move focus into the dialog on open (the confirm button is the primary action).
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Escape dismisses; Tab is trapped within the panel.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  const everyMoveHasTarget = items.every(
    (item) => item.action !== 'move' || item.targetCycleId !== null,
  );
  const summary = summarize(items);

  // Rendered into the body so the overlay escapes any clipped/scrolled ancestor.
  if (typeof document === 'undefined') return <></>;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      {/* Backdrop — click to dismiss. */}
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        onClick={onCancel}
        className="bg-background/70 absolute inset-0 cursor-default backdrop-blur-sm"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="bg-card border-border relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border shadow-lg"
      >
        <header className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-foreground text-base font-semibold">
              Close {cycleName}
            </h2>
            <p id={descId} className="text-muted-foreground text-sm">
              {items.length === 0
                ? `Everything committed to this ${cycleNoun} is complete — nothing to carry over.`
                : `Review what happens to ${String(items.length)} open ${
                    items.length === 1 ? 'task' : 'tasks'
                  } before this ${cycleNoun} rolls.`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="Cancel"
            className="-mt-1 -mr-1 shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

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

        <footer className="border-border flex items-center justify-between gap-4 border-t px-5 py-4">
          <span className="text-muted-foreground text-xs">
            {items.length === 0 ? 'Ready to close' : summary}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={closing}>
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              size="sm"
              onClick={onConfirm}
              disabled={closing || !everyMoveHasTarget}
              className={cn(!everyMoveHasTarget && 'cursor-not-allowed')}
            >
              {closing ? 'Closing…' : `Close ${cycleNoun}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
