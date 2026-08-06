/** The total number of minutes represented by the scheduling canvas. */
export const MINUTES_PER_DAY = 24 * 60;

/** The smallest interaction increment exposed at high zoom. */
export const MINIMUM_SNAP_MINUTES = 5;

/** Smallest legal zoom — roughly a full day in view without the grid collapsing. */
export const MIN_PIXELS_PER_HOUR = 24;
/** Largest legal zoom — fine enough to place a five-minute block by hand. */
export const MAX_PIXELS_PER_HOUR = 240;
/** The one sane default density every new viewer starts at, and the `100%` zoom reference. */
export const DEFAULT_PIXELS_PER_HOUR = 72;

/** Multiplier applied by one press of the zoom-in step. */
export const ZOOM_STEP_IN = 1.25;
/** Multiplier applied by one press of the zoom-out step — the inverse-ish of {@link ZOOM_STEP_IN}. */
export const ZOOM_STEP_OUT = 0.8;

/**
 * Clamp and round any proposed zoom to a legal, persistable pixels-per-hour value.
 *
 * @remarks
 * The single funnel every zoom source flows through — preset, stepper, reset, and the canvas's raw
 * pinch scale — so no code path can persist an out-of-range or fractional height. Non-finite input
 * (a `NaN` from a degenerate gesture, say) resolves to {@link DEFAULT_PIXELS_PER_HOUR} rather than
 * propagating into layout math.
 *
 * It lives here rather than beside the calendar's Display menu because the rail's own scale stepper
 * needs the identical funnel, and a `components/` module must not import an `app/` route module.
 *
 * @param value - The proposed pixels-per-hour, from any source.
 * @returns an integer within `[MIN_PIXELS_PER_HOUR, MAX_PIXELS_PER_HOUR]`.
 *
 * @example
 * ```ts
 * clampPixelsPerHour(71.4);       // 71
 * clampPixelsPerHour(1_000);      // 240
 * clampPixelsPerHour(Number.NaN); // 72
 * ```
 */
export function clampPixelsPerHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PIXELS_PER_HOUR;
  return Math.min(MAX_PIXELS_PER_HOUR, Math.max(MIN_PIXELS_PER_HOUR, Math.round(value)));
}

/**
 * Measured canvas width at or above which the hour axis keeps its full form.
 *
 * @remarks
 * Below this the canvas is a rail, not a page. The full axis costs 88px of gutter because it has to
 * hold `12:00 AM` on one line at 14px, which is 3% of a 1440px canvas and **34% of a 280px rail** —
 * a third of the surface spent on labels nobody reads twice.
 */
export const COMPACT_AXIS_MAX_WIDTH = 640;

/** Gutter width and label form chosen together, since one sizes the other. */
export interface ScheduleAxisPresentation {
  /** Width reserved for hour labels. */
  readonly gutterWidth: number;
  /** `exact` renders `12:00 AM`; `hour` renders `12 AM` and never labels a sub-hour tick. */
  readonly labelStyle: 'exact' | 'hour';
}

const FULL_AXIS: ScheduleAxisPresentation = { gutterWidth: 88, labelStyle: 'exact' };
/**
 * 44px, not the ~32px a reference rail gets away with.
 *
 * @remarks
 * Those rails print their hours at 10–11px. Round 3 established a hard 14px floor for this surface
 * — zero rendered nodes at or below 12px — and `12 AM` at 14px measures ~38px plus its 4px inset.
 * Halving the gutter is worth having; buying the other 12px by regressing a shipped type guarantee
 * is not.
 */
const COMPACT_AXIS: ScheduleAxisPresentation = { gutterWidth: 44, labelStyle: 'hour' };

/**
 * Choose the hour axis's width and label form from the measured canvas width.
 *
 * @remarks
 * An **unmeasured** viewport (`0`) resolves to the full axis rather than the compact one. Zero is
 * every canvas's first paint, and resolving it compact would make the wide calendar flash a 32px
 * gutter before its first measurement. The rail's own 88 → 32 correction lands in the same layout
 * pass as its lane width's 0 → real correction, which already reflows the surface, so it costs no
 * additional frame.
 *
 * @param viewportWidth - Measured canvas width in CSS pixels, or `0` when unmeasured.
 * @returns The gutter width and label form for that width.
 */
export function deriveScheduleAxis(viewportWidth: number): ScheduleAxisPresentation {
  if (viewportWidth <= 0) return FULL_AXIS;
  return viewportWidth < COMPACT_AXIS_MAX_WIDTH ? COMPACT_AXIS : FULL_AXIS;
}

/** Viewport-derived horizontal lane measurements. */
export interface ScheduleLaneGeometry {
  /** Width reserved for hour labels. */
  readonly gutterWidth: number;
  /** Width assigned to every lane. */
  readonly laneWidth: number;
  /** Number of complete lanes visible without horizontal scrolling. */
  readonly visibleLaneCount: number;
  /** Full scrollable width of the lane region. */
  readonly contentWidth: number;
}

/** Inputs for {@link deriveLaneGeometry}. */
export interface DeriveLaneGeometryOptions {
  readonly viewportWidth: number;
  readonly laneCount: number;
  readonly gutterWidth?: number;
  readonly minimumLaneWidth?: number;
}

/**
 * Derive fluid lane width and visible count from the current viewport.
 *
 * The function has no day/week modes and makes no assumption about lane count. When lanes overflow,
 * every lane retains the same width and the canvas scrolls horizontally. With no lanes, the hour
 * grid still occupies all available width so empty/error states never replace its geometry.
 */
export function deriveLaneGeometry({
  viewportWidth,
  laneCount,
  gutterWidth = 64,
  minimumLaneWidth = 220,
}: DeriveLaneGeometryOptions): ScheduleLaneGeometry {
  const safeViewport = Math.max(0, viewportWidth);
  const safeGutter = Math.max(0, Math.min(gutterWidth, safeViewport));
  const availableWidth = Math.max(0, safeViewport - safeGutter);
  const safeMinimum = Math.max(1, minimumLaneWidth);

  if (laneCount <= 0) {
    return {
      gutterWidth: safeGutter,
      laneWidth: availableWidth,
      visibleLaneCount: 0,
      contentWidth: availableWidth,
    };
  }

  const visibleLaneCount = Math.min(
    Math.floor(laneCount),
    Math.max(1, Math.floor(availableWidth / safeMinimum)),
  );
  const laneWidth = availableWidth > 0 ? availableWidth / visibleLaneCount : safeMinimum;
  return {
    gutterWidth: safeGutter,
    laneWidth,
    visibleLaneCount,
    contentWidth: laneWidth * Math.floor(laneCount),
  };
}

/**
 * Pick a time snap from continuous zoom while never becoming finer than five minutes.
 *
 * The first increment producing at least eight physical pixels wins. This keeps pointer targets
 * usable while smoothly moving through 60, 30, 15, 10, and 5-minute precision as zoom increases.
 */
export function deriveSnapMinutes(pixelsPerHour: number): number {
  const safePixelsPerHour = Math.max(1, pixelsPerHour);
  const candidates = [5, 10, 15, 30, 60] as const;
  return candidates.find((minutes) => (minutes / 60) * safePixelsPerHour >= 8) ?? 60;
}

/** Convert a minute-of-day value into a vertical canvas offset. */
export function minutesToPixels(minutes: number, pixelsPerHour: number): number {
  return (Math.max(0, Math.min(MINUTES_PER_DAY, minutes)) / 60) * Math.max(1, pixelsPerHour);
}

/** Convert a vertical canvas offset into a snapped minute-of-day value. */
export function pixelsToMinutes(
  pixels: number,
  pixelsPerHour: number,
  snapMinutes = deriveSnapMinutes(pixelsPerHour),
): number {
  const rawMinutes = (Math.max(0, pixels) / Math.max(1, pixelsPerHour)) * 60;
  const snapped = Math.round(rawMinutes / snapMinutes) * snapMinutes;
  return Math.max(0, Math.min(MINUTES_PER_DAY, snapped));
}

/** Convert a signed pointer delta into a snapped signed minute delta. */
export function pixelDeltaToMinutes(
  pixels: number,
  pixelsPerHour: number,
  snapMinutes = deriveSnapMinutes(pixelsPerHour),
): number {
  const rawMinutes = (pixels / Math.max(1, pixelsPerHour)) * 60;
  return Math.round(rawMinutes / snapMinutes) * snapMinutes;
}

/** Resolve a horizontal canvas offset to an arbitrary lane index. */
export function laneIndexAtOffset(
  offsetX: number,
  laneCount: number,
  laneWidth: number,
): number | null {
  if (laneCount <= 0 || laneWidth <= 0) return null;
  return Math.max(0, Math.min(Math.floor(laneCount) - 1, Math.floor(offsetX / laneWidth)));
}
