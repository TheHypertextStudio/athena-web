'use client';

/**
 * `components/plan-canvas/plan-status` — the small vocabulary every plan node shares.
 *
 * @remarks
 * A draft node borrows the proposal system's ghost grammar: a dashed outline at reduced weight,
 * a dashed glyph, and a `draft` pill. A confirmed node is the ordinary tonal card with a filled
 * check. Keeping the pieces here means the three renderers and the inspector cannot drift into
 * three readings of "not real yet".
 */
import type { PlanNodeStatus } from '@docket/work/plan-draft-contract';
import { CheckCircle2, CircleDashed } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

/** The view-transition name a plan node carries so confirmation morphs it in place. */
export function planNodeTransitionName(ref: string): string {
  return `plan-node-${ref.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** The status glyph: dashed while a draft, a filled check once created. */
export function PlanStatusGlyph({
  status,
  className,
}: {
  readonly status: PlanNodeStatus;
  readonly className?: string;
}): JSX.Element {
  const Glyph = status === 'draft' ? CircleDashed : CheckCircle2;
  return (
    <Glyph
      role="img"
      aria-label={status === 'draft' ? 'Draft' : 'Created'}
      data-plan-status={status}
      className={cn(
        'size-4 shrink-0',
        status === 'draft' ? 'text-primary/70' : 'text-state-completed',
        className,
      )}
    />
  );
}

/** The `draft` pill, in the proposal card's own grammar. */
export function PlanDraftPill({ className }: { readonly className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'border-primary/40 text-primary text-label-small shrink-0 rounded-full border px-1.5 py-px',
        className,
      )}
    >
      draft
    </span>
  );
}

/** The `created` mark a confirmed node shows where a draft shows its pill. */
export function PlanCreatedMark({ className }: { readonly className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'text-state-completed text-label-small inline-flex shrink-0 items-center gap-0.5',
        className,
      )}
    >
      <CheckCircle2 aria-hidden="true" className="size-3" />
      created
    </span>
  );
}

/** Text that sweeps with a highlight when the latest revision changed its field. */
export function PlanField({
  changed,
  className,
  children,
}: {
  readonly changed: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(changed && 'plan-field-changed', className)}
      data-changed={changed || undefined}
    >
      {children}
    </span>
  );
}

/** The classes a plan card wears for its status and its arrival. */
export function planCardClasses(
  status: PlanNodeStatus,
  entered: boolean,
  selected: boolean,
): string {
  return cn(
    'transition-colors',
    status === 'draft' && 'border-primary/40 border border-dashed',
    entered && 'plan-node-enter',
    selected && 'ring-primary ring-2',
  );
}
