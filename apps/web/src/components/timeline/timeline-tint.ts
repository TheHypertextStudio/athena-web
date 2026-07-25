/**
 * `timeline` — the semantic tone vocabulary shared by every timeline surface.
 *
 * @remarks
 * The engine knows nothing about Project health, Program status, or any other domain vocabulary; a
 * consumer maps its own semantics onto four abstract {@link TimelineTint} tones and this module is
 * the only place those tones become pixels.
 *
 * **Bars are calm.** A timeline is mostly bars, so filling each one with a saturated status colour
 * turns the whole canvas into a stoplight and buries the thing the chart is actually about —
 * *when* work happens. Every bar therefore shares one neutral tonal surface, and the semantic
 * colour is carried by a narrow accent at the bar's leading edge plus the dot in the label column.
 * That keeps health scannable at a glance while letting position and duration read first, and it
 * keeps the surface consistent with the app's tonal hierarchy instead of introducing four
 * high-chroma slabs.
 *
 * Colour is only ever a design-system token class — never a raw hex — so both themes and any
 * future palette change are handled centrally.
 */
import type { TimelineTint } from './timeline-catalog';

/**
 * The shared bar body: one neutral tonal surface for every tone.
 *
 * @remarks
 * A tonal step above the plot area rather than a coloured fill, so a bar reads as an object on the
 * canvas instead of as an alert. Text is the normal on-surface colour, which stays legible in both
 * themes without the white-on-saturated contrast gamble.
 */
export const BAR_SURFACE_CLASS =
  'bg-surface-container-highest text-on-surface border-outline-variant';

/**
 * The leading-edge accent that carries the semantic tone.
 *
 * @remarks
 * A narrow stripe at the bar's start — the eye already goes there to read the start date, so the
 * health signal costs no extra scanning and no extra chroma across the bar's whole length.
 */
export const TINT_ACCENT_CLASS: Record<TimelineTint, string> = {
  positive: 'bg-state-completed',
  caution: 'bg-state-canceled',
  critical: 'bg-destructive',
  neutral: 'bg-outline',
};

/**
 * The border colour for a single-date anchor diamond.
 *
 * @remarks
 * An anchor is too small to carry a leading accent stripe, so its outline carries the tone instead
 * — the same calm treatment scaled to a marker rather than a bar.
 */
export const TINT_ANCHOR_BORDER_CLASS: Record<TimelineTint, string> = {
  positive: 'border-state-completed',
  caution: 'border-state-canceled',
  critical: 'border-destructive',
  neutral: 'border-outline',
};

/** The small swatch/dot fill per tone, for label-column dots and tray chips. */
export const TINT_DOT_CLASS: Record<TimelineTint, string> = {
  positive: 'bg-state-completed',
  caution: 'bg-state-canceled',
  critical: 'bg-destructive',
  neutral: 'bg-on-surface-variant',
};

/**
 * The completion fill drawn inside a bar.
 *
 * @remarks
 * Another tonal step rather than a second colour, so progress reads as "how much of this bar is
 * done" without competing with the health accent.
 */
export const PROGRESS_FILL_CLASS = 'bg-on-surface/10';
