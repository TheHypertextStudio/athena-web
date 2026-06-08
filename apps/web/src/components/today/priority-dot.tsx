'use client';

import type { Priority } from '@docket/types';
import type { JSX } from 'react';

/**
 * The Tailwind token utility class for each {@link Priority}'s urgency tint.
 *
 * @remarks
 * Static keys (no string interpolation) keep the classes discoverable by Tailwind's
 * content scanner. `none` reads as a muted hairline ring; the actionable priorities
 * escalate from the calm `on-surface-variant` through to the `destructive` token for
 * `urgent`, so a glance down the plan surfaces what matters without a legend.
 */
const PRIORITY_TINT: Record<Priority, string> = {
  none: 'bg-transparent ring-1 ring-inset ring-outline-variant',
  low: 'bg-on-surface-variant/40',
  medium: 'bg-state-started/70',
  high: 'bg-state-backlog',
  urgent: 'bg-destructive',
};

/** The human-readable label announced for each {@link Priority}. */
const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
  urgent: 'Urgent priority',
};

/** Props for {@link PriorityDot}. */
export interface PriorityDotProps {
  /** The task's priority level. */
  priority: Priority;
}

/**
 * A compact priority indicator dot for a plan row.
 *
 * @remarks
 * Renders a small, token-colored dot whose tint escalates with urgency, with an
 * accessible label so screen readers announce the priority. Lower-priority work stays
 * visually quiet so the plan reads calm; `urgent` adopts the `destructive` token to draw
 * the eye. Colors come exclusively from semantic design tokens — never hardcoded.
 */
export function PriorityDot({ priority }: PriorityDotProps): JSX.Element {
  return (
    <span
      role="img"
      aria-label={PRIORITY_LABEL[priority]}
      title={PRIORITY_LABEL[priority]}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_TINT[priority]}`}
    />
  );
}
