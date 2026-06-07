import type { Priority } from '@docket/types';

/**
 * The human-readable label for each {@link Priority} level.
 *
 * @remarks
 * `none` reads as "No priority" so an unset value is explicit rather than blank in the
 * properties panel and the priority picker.
 */
export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * The canonical priority ordering, from most to least pressing, with `none` last.
 *
 * @remarks
 * Drives the order priorities appear in the picker menu so the most actionable choice
 * (Urgent) sits at the top and the absence of a priority is the final option.
 */
export const PRIORITY_ORDER: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/**
 * The token-backed bar color for each {@link Priority}, used by the priority glyph.
 *
 * @remarks
 * Colors come exclusively from semantic design tokens (`bg-destructive`,
 * `bg-foreground`, `bg-muted-foreground`, `bg-muted`) — never hardcoded — so the glyph
 * adapts to light/dark themes. `urgent` borrows the destructive token to read as the
 * loudest signal; descending levels step down in emphasis toward the muted `none`.
 */
export const PRIORITY_BAR_CLASS: Record<Priority, string> = {
  urgent: 'bg-destructive',
  high: 'bg-foreground',
  medium: 'bg-foreground/70',
  low: 'bg-muted-foreground',
  none: 'bg-muted',
};
