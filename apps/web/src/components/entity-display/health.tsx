'use client';

/**
 * `entity-display/health` — the one presentation of health, wherever it is read.
 *
 * @remarks
 * `on_track | at_risk | off_track` means the same thing on a Project, a Program, and an
 * Initiative, so it should look the same on all three. It did not: four screens each kept their
 * own token module, and every record in them was identical — the same labels, and one colour
 * record living under two names, because a dot and a bar segment had been treated as different
 * questions. They are the same question.
 *
 * Health is one of the few things the colour budget is spent on (craft rubric §5 — colour is
 * earned by semantics), which is why the colour sits on the label itself rather than only on a 6px
 * dot: it has to survive being read at a glance.
 */
import type { Health } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** Human-readable label for each {@link Health} value. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The solid colour for each value — a dot, a swatch, or a distribution segment.
 *
 * @remarks
 * `on_track` borrows the calm green `completed` state token and `off_track` the `error` role.
 * `at_risk` has a token of its own: it used to borrow `canceled`, a near-grey chosen so that
 * cancelled work recedes, which left the one value worth catching early as the hardest of the
 * three to see.
 */
export const HEALTH_FILL_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-health-at-risk',
  off_track: 'bg-error',
};

/**
 * The tonal fill and foreground an `IdentityGlyph` takes for each value.
 *
 * @remarks
 * A roster's job is to answer "which of these needs me?" before anything is read, and health
 * spelled only in a label and a 6px dot cannot answer it across a grid. Tinting the entity's own
 * identity mark makes health the largest coloured thing on a card without spending colour on
 * anything new. The label stays, so the meaning never rests on colour alone.
 */
export const HEALTH_GLYPH_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed/15 text-state-completed',
  at_risk: 'bg-health-at-risk/15 text-health-at-risk',
  off_track: 'bg-error/15 text-error',
};

/** The fill for children carrying no health, in an Initiative's distribution bar. */
export const HEALTH_UNKNOWN_FILL_CLASS = 'bg-on-surface-variant/30';

/** The label for the unknown-health bucket in a distribution legend. */
export const HEALTH_UNKNOWN_LABEL = 'No health data';

/** The label colour paired with each {@link HEALTH_FILL_CLASS} fill. */
const HEALTH_TEXT_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed',
  at_risk: 'text-health-at-risk',
  off_track: 'text-error',
};

/** Props for {@link HealthLabel}. */
export interface HealthLabelProps {
  /** The health value, or `null` when nobody has set one. */
  readonly health: Health | null;
}

/**
 * Health as a coloured dot and its label.
 *
 * @param props - The {@link HealthLabelProps}.
 * @returns the label, or an em dash when health is unset.
 */
export function HealthLabel({ health }: HealthLabelProps): JSX.Element {
  if (!health) {
    return <span className="text-on-surface-variant">—</span>;
  }
  return (
    <span className={cn(HEALTH_TEXT_CLASS[health], 'text-label-medium flex items-center gap-2')}>
      <span
        aria-hidden="true"
        className={cn(HEALTH_FILL_CLASS[health], 'size-1.5 shrink-0 rounded-full')}
      />
      {HEALTH_LABEL[health]}
    </span>
  );
}
