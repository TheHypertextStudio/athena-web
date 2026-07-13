/** The total number of minutes represented by the scheduling canvas. */
export const MINUTES_PER_DAY = 24 * 60;

/** The smallest interaction increment exposed at high zoom. */
export const MINIMUM_SNAP_MINUTES = 5;

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
