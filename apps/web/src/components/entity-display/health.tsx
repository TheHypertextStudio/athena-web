'use client';

/**
 * `entity-display/health` — the one presentation of a health verdict, wherever it is read.
 *
 * @remarks
 * `on_track | at_risk | off_track` is the same judgment on a Project, a Program, and an
 * Initiative, so it should look the same on all three. It did not: the roster list carried its
 * own label + colour records, the Programs card carried a dot-only variant that left the label
 * grey, and `programs/`, `projects/`, and `initiatives/` each kept a near-identical token module.
 * Four spellings of one verdict is four chances for them to drift apart.
 *
 * Health is one of the few things the colour budget is spent on (craft rubric §5 — colour is
 * earned by semantics), which is exactly why it should be spent the same way every time. The
 * colour lives on the label itself rather than only on a 6px dot, so the verdict survives being
 * read at a glance.
 */
import type { Health } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** Human-readable label for each {@link Health} verdict. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The solid dot fill for each verdict.
 *
 * @remarks
 * `on_track` borrows the calm green `completed` state token, `at_risk` the amber `canceled` token,
 * and `off_track` the `error` role — so a verdict resolves in both themes without a raw value.
 */
export const HEALTH_DOT_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-error',
};

/**
 * The tonal fill and foreground an {@link IdentityGlyph} takes for each verdict.
 *
 * @remarks
 * A roster's job is to answer "which of these needs me?" before anything is read, and a verdict
 * spelled only in a label and a 6px dot cannot answer it at a glance across a grid. Tinting the
 * entity's own identity mark makes the verdict the largest coloured thing on a card without
 * spending colour on anything new — the mark was already there, in neutral. The label stays, so
 * the meaning never rests on colour alone.
 */
export const HEALTH_GLYPH_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed/15 text-state-completed',
  at_risk: 'bg-state-canceled/15 text-state-canceled',
  off_track: 'bg-error/15 text-error',
};

/** The label colour paired with each {@link HEALTH_DOT_CLASS} fill. */
export const HEALTH_TEXT_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed',
  at_risk: 'text-state-canceled',
  off_track: 'text-error',
};

/** Props for {@link HealthLabel}. */
export interface HealthLabelProps {
  /** The verdict, or `null` when nobody has set one. */
  readonly health: Health | null;
  /** Extra classes merged after the token colour and type role. */
  readonly className?: string | undefined;
}

/**
 * A health verdict as a coloured dot and its label.
 *
 * @param props - The {@link HealthLabelProps}.
 * @returns the verdict, or an em dash when it is unset.
 */
export function HealthLabel({ health, className }: HealthLabelProps): JSX.Element {
  if (!health) {
    return <span className={cn('text-on-surface-variant', className)}>—</span>;
  }
  return (
    <span
      className={cn(
        HEALTH_TEXT_CLASS[health],
        'text-label-medium flex items-center gap-2',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(HEALTH_DOT_CLASS[health], 'size-1.5 shrink-0 rounded-full')}
      />
      {HEALTH_LABEL[health]}
    </span>
  );
}
