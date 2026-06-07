/**
 * Health presentation for the Hub Portfolio timeline.
 *
 * @remarks
 * The portfolio aggregates Projects + Programs across every org the caller belongs to, and a
 * Project/Program's `health` arrives as a free string on the wire (the Hub DTOs carry health as
 * `string | null`, not the strict {@link Health} enum, so a tenant-specific value never breaks
 * the cross-org read). These helpers narrow that string back to a known {@link Health} verdict
 * and map it onto the same semantic `--color-state-*` / `--color-destructive` tokens the
 * Initiatives roadmap and Project detail use — so a struggling effort reads the calm-amber /
 * destructive-red the rest of the product already speaks, and an unknown/absent verdict falls
 * back to a quiet neutral fill. Color is *only* ever a token class here — never a raw hex.
 */
import type { Health } from '@docket/types';

/** The known health verdicts, narrowest-worst last (drives the legend + worst-of rollups). */
const KNOWN_HEALTH: readonly Health[] = ['on_track', 'at_risk', 'off_track'];

/**
 * Narrow a free wire string to a known {@link Health} verdict.
 *
 * @param value - The `health` string from a portfolio bar/lane, or null/undefined.
 * @returns the matching {@link Health}, or null when absent or unrecognized.
 */
export function asHealth(value: string | null | undefined): Health | null {
  return value && (KNOWN_HEALTH as readonly string[]).includes(value) ? (value as Health) : null;
}

/** Human-readable label for each {@link Health} verdict. */
export const HEALTH_LABEL: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
};

/** The label used for a bar/lane that carries no health verdict yet. */
export const HEALTH_UNKNOWN_LABEL = 'No verdict';

/**
 * The solid fill (used for a project bar's body), keyed by verdict.
 *
 * @remarks
 * Mirrors the Initiatives roadmap so the two timelines read as one product: `on_track` → the
 * calm green `completed` token, `at_risk` → the amber `canceled` token, `off_track` →
 * `destructive`.
 */
export const HEALTH_FILL_CLASS: Record<Health, string> = {
  on_track: 'bg-state-completed',
  at_risk: 'bg-state-canceled',
  off_track: 'bg-destructive',
};

/** The dot/swatch fill for a health verdict (legend chips, program-lane swatches). */
export const HEALTH_DOT_CLASS = HEALTH_FILL_CLASS;

/**
 * The dot/swatch fill used for a bar/lane with no verdict yet (the neutral bucket).
 *
 * @remarks
 * Used for the small legend swatch and the program-lane / unscheduled-tray dots, this is a
 * *solid* mid-grey (`muted-foreground`) so a tiny no-verdict marker stays clearly visible in
 * both light and dark themes — a translucent wash (the old `/30`) was effectively invisible.
 */
export const HEALTH_UNKNOWN_FILL_CLASS = 'bg-muted-foreground';

/** The fill class for a swatch/dot, defaulting to the neutral no-verdict fill. */
export function fillFor(health: Health | null): string {
  return health ? HEALTH_FILL_CLASS[health] : HEALTH_UNKNOWN_FILL_CLASS;
}

/**
 * The full class string for a *project bar* body, keyed by verdict.
 *
 * @remarks
 * A bar is a large surface carrying a label, so contrast matters more than for a dot. The
 * three verdict bars take a saturated fill with white text and no border; a *no-verdict* bar
 * takes the neutral `secondary` surface + its theme-aware foreground (never washed-out white
 * on a light grey) plus a visible `border`, so every bar — verdict or not — reads as a solid,
 * legible bar against the timeline grid.
 */
export function barClassFor(health: Health | null): string {
  return health
    ? `${HEALTH_FILL_CLASS[health]} border-transparent text-white`
    : 'bg-secondary text-secondary-foreground border-border';
}

/** The display label for a health verdict, defaulting to the no-verdict label. */
export function labelFor(health: Health | null): string {
  return health ? HEALTH_LABEL[health] : HEALTH_UNKNOWN_LABEL;
}
