/**
 * Health presentation helpers for the project-detail screen.
 *
 * @remarks
 * A Project's `health` is a judgment verdict (`on_track | at_risk | off_track`) shared by
 * Programs and Initiatives (data-model §4; {@link Health}). These helpers map the verdict
 * onto display-ready copy and the semantic token classes used by the health pill, the
 * weighted-progress bar fill, and the per-update health dot — so health color stays
 * consistent across the whole screen and never reaches for a raw hex value.
 */
import type { Health } from '@docket/types';

/** Human-readable label for each {@link Health} verdict (and the unset case). */
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
 * `backlog`-adjacent warning treatment, and `off_track` the `destructive` token — all
 * sourced from `@docket/ui/styles/globals.css` so light/dark themes resolve automatically.
 */
export const HEALTH_PILL_CLASS: Record<Health, string> = {
  on_track: 'text-state-completed bg-state-completed/10 ring-1 ring-inset ring-state-completed/30',
  at_risk: 'text-state-canceled bg-state-canceled/10 ring-1 ring-inset ring-state-canceled/30',
  off_track: 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/30',
};

/** The fill color for the weighted-progress bar, keyed by the project's health. */
export const HEALTH_FILL_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

/** A small solid health dot color (for per-update health markers). */
export const HEALTH_DOT_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

/**
 * Resolve a {@link Health} verdict from a nullable value, defaulting to a neutral fallback.
 *
 * @param health - The (possibly null/undefined) health value off a DTO.
 * @returns the verdict when set, else `null`.
 */
export function readHealth(health: Health | null | undefined): Health | null {
  return health ?? null;
}
