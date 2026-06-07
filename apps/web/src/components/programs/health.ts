/**
 * Health presentation helpers for the Programs screens.
 *
 * @remarks
 * A Program's `health` is the same judgment verdict (`on_track | at_risk | off_track`)
 * shared by Projects and Initiatives (data-model §4; {@link Health}). These helpers map
 * the verdict onto display-ready copy and the semantic token classes used by the Program
 * health pill, the flow snapshot, and the per-update health dot — so health color stays
 * consistent across the screen and never reaches for a raw hex value. Kept local to the
 * Programs screen (rather than imported from another screen's folder) so the screen owns
 * its own presentation surface.
 */
import type { Health } from '@docket/types';

/** Human-readable label for each {@link Health} verdict. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/**
 * The Tailwind classes for a health pill (text + subtle tinted background + ring).
 *
 * @remarks
 * `on_track` borrows the `completed` state token (a calm green), `at_risk` the amber-ish
 * `canceled` warning treatment, and `off_track` the `destructive` token — all sourced from
 * `@docket/ui/styles/globals.css` so light/dark themes resolve automatically.
 */
export const HEALTH_PILL_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed bg-state-completed/10 ring-1 ring-inset ring-state-completed/30',
  at_risk: 'text-state-canceled bg-state-canceled/10 ring-1 ring-inset ring-state-canceled/30',
  off_track: 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/30',
};

/** A small solid health dot color (for the flow snapshot and per-update markers). */
export const HEALTH_DOT_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};
