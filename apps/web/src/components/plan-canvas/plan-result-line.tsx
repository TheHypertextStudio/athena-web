'use client';

/**
 * `components/plan-canvas/plan-result-line` — the one line a confirm leaves behind.
 *
 * @remarks
 * After a commit the slot above the view controls names what was created, kind by kind, with an
 * Undo beside it. Undo reverses the whole commit; the line then reads "Undone" with the counts
 * struck through, still one line. A failed Undo replaces the counts with its cause and keeps Undo
 * reachable so the person can try again.
 */
import { CheckCircle2, Undo, X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Surface } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { type PlanResult, planResultText } from './plan-result';

/** Props for {@link PlanResultLine}. */
export interface PlanResultLineProps {
  readonly result: PlanResult;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** The colour and weight the line's text takes for where the result is. */
function textClasses(result: PlanResult): string {
  if (result.error !== null) return 'text-error';
  if (result.phase === 'undone') return 'text-on-surface-variant line-through';
  return 'text-on-surface';
}

/** Whether the line offers Undo: a commit that created something and is not yet undone. */
function canUndo(result: PlanResult): boolean {
  return result.changeSetId !== null && result.phase !== 'undone';
}

/** The line after a confirm: what was created, and Undo. */
export function PlanResultLine({ result, onUndo, onDismiss }: PlanResultLineProps): JSX.Element {
  const undone = result.phase === 'undone';
  return (
    <Surface
      tone="prominent"
      shape="small"
      role={result.error === null ? 'status' : 'alert'}
      data-testid="plan-result"
      data-phase={result.phase}
      className="pointer-events-auto flex w-max max-w-[min(44rem,calc(100vw-2rem))] min-w-0 items-center gap-2 py-1 pr-1 pl-3"
    >
      {undone ? (
        <span className="text-on-surface text-label-large shrink-0">Undone</span>
      ) : (
        <CheckCircle2 aria-hidden="true" className="text-primary size-4 shrink-0" />
      )}
      <span className={cn('text-body-medium min-w-0 truncate', textClasses(result))}>
        {result.error ?? planResultText(result)}
      </span>
      {canUndo(result) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={result.phase === 'undoing'}
          onClick={onUndo}
        >
          <Undo className="size-4" /> Undo
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Dismiss"
        className="shrink-0"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </Button>
    </Surface>
  );
}
