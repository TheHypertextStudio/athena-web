/**
 * Health presentation helpers for the Initiatives screens.
 *
 * @remarks
 * An Initiative is a theme that holds no work of its own: its signal is *auto-derived*
 * from the Projects + Programs it associates with. The detail read returns a
 * `rolledUpHealth` (the worst child verdict — `off_track ≻ at_risk ≻ on_track`) and a
 * `distribution` (how many children fall in each {@link Health} bucket, plus the count with
 * no verdict). These helpers map those derived values onto display-ready copy and the
 * semantic `--color-state-*` / `--color-destructive` token classes, so health color stays
 * consistent across the list, the rolled-up pill, the distribution bar, and the roadmap —
 * and never reaches for a raw hex value.
 *
 * The token mapping mirrors the project-detail screen (`on_track` → the calm green
 * `completed` token, `at_risk` → the amber `canceled` token, `off_track` → `destructive`)
 * so the two screens read as one product.
 */
import type { Health } from '@docket/types';

/** Human-readable label for each {@link Health} verdict. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The Tailwind classes for a health pill (text + subtle tinted background + inset ring),
 * keyed by the derived {@link Health} verdict. Tokens resolve light/dark automatically.
 */
export const HEALTH_PILL_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed bg-state-completed/10 ring-1 ring-inset ring-state-completed/30',
  at_risk: 'text-state-canceled bg-state-canceled/10 ring-1 ring-inset ring-state-canceled/30',
  off_track: 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/30',
};

/** The solid fill color for a health swatch / distribution segment, keyed by verdict. */
export const HEALTH_FILL_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

/** The fill color used for children that carry no health verdict yet (the neutral bucket). */
export const HEALTH_UNKNOWN_FILL_CLASS = 'bg-muted-foreground/30';

/** The label used for the no-verdict bucket in distribution legends. */
export const HEALTH_UNKNOWN_LABEL = 'No verdict';
