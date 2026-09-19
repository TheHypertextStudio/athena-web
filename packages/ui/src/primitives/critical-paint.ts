/**
 * `@docket/ui` — the critical (error-role) colour for status geometry.
 *
 * @remarks
 * Product code presents a failure through a notice, `FieldError`, `InlineBanner`, or `LoadFailure`,
 * and never paints the error colour by hand. A few surfaces draw a critical *state* instead of
 * saying one: a violated dependency edge, a rejected drop preview, the current-time line. Those
 * marks take their colour from this module, so the error role stays owned by the primitive layer
 * and the `docket-ui/no-raw-error-text` rule can hold every other file to zero raw error tokens.
 * Literal class names live here so Tailwind's scanner sees them.
 */

/** Class names for one critical mark, by what is being painted. */
export const CRITICAL_PAINT = {
  /** A ring around a control, bar, or marker. */
  ring: 'ring-error',
  /** A ring that appears when the control is `aria-invalid`. */
  ringWhenInvalid: 'aria-invalid:ring-error',
  /** A solid line, such as the current-time rule. */
  line: 'bg-error',
  /** A translucent line, such as a target-date marker. */
  lineSoft: 'bg-error/70',
  /** An SVG stroke for a violated connector. */
  stroke: 'stroke-error/70',
  /** A rejected drop preview: container fill and its readable text. */
  rejectedBlock: 'bg-error-container text-on-error-container',
  /** The label chip on a rejected drop: container fill and its readable text. */
  rejectedLabel: 'bg-error-container text-on-error-container',
  /** A rejected drop onto a card: a translucent ring and wash, drawn inside the card's edge. */
  rejectedDrop: 'ring-error/60 bg-error/5',
  /** A translucent tint over an invalid region. */
  invalidRegion: 'bg-error-container/60',
} as const;

/** The mark a {@link CRITICAL_PAINT} entry paints. */
export type CriticalPaint = keyof typeof CRITICAL_PAINT;
