/**
 * `timeline` — the time axis: viewport windows, calendar tick marks, and the projection from an
 * instant to a horizontal offset.
 *
 * @remarks
 * The **viewport is the source of truth**, and it is deliberately decoupled from the data extents.
 * An axis derived from "earliest start to latest target" (the shape the old Projects lens used)
 * has three defects: bars always kiss both edges, the window silently changes whenever the data
 * does, and zoom/pan have nothing stable to operate on. Here the viewport is an exact
 * `[min, max]` interval that the user pans and zooms directly; ticks are the calendar boundaries
 * that happen to *fall inside* it. Nothing snaps the viewport itself, so repeated zooming never
 * drifts and a bar's position is a pure function of the window.
 *
 * All boundary math is UTC. Date-only wire values (`YYYY-MM-DD`) parse to UTC midnight, so any
 * local-time arithmetic would shift a date by a day for viewers west of UTC — the defect the
 * previous implementation shipped. {@link parseDate} is the single entry point for wire dates and
 * every helper below stays in UTC.
 *
 * Offsets are emitted as 0–100 percentages of the window ({@link pct}) so bars, gridlines, and the
 * today rule lay out responsively against whatever pixel width the scroll container resolves to.
 */
import type { ViewScale } from '@/components/views/field-catalog';

/** One day in milliseconds — the floor for span math and single-date bars. */
export const DAY_MS = 86_400_000;

/** A concrete (non-auto) granularity — what the axis actually renders at. */
export type ResolvedGranularity = Exclude<ViewScale, 'auto'>;

/** A single axis tick: its epoch-ms position and its already-formatted label. */
export interface Tick {
  /** The tick's position in epoch milliseconds. */
  readonly at: number;
  /** The pre-formatted, granularity-appropriate label (e.g. `Jun`, `Q3 '26`). */
  readonly label: string;
  /**
   * Whether this tick opens a larger calendar unit (a month within weeks/days, a year within
   * months/quarters), so the axis header can draw a two-tier band rather than one flat strip.
   */
  readonly major: boolean;
}

/** An exact, unsnapped viewport interval in epoch milliseconds. */
export interface TimeWindow {
  /** The window lower bound in epoch milliseconds. */
  readonly min: number;
  /** The window upper bound in epoch milliseconds. */
  readonly max: number;
}

/** The resolved scale: the effective granularity, the viewport, and the tick marks inside it. */
export interface TimeScale extends TimeWindow {
  /** The granularity actually rendered (`auto` resolved to a concrete value). */
  readonly granularity: ResolvedGranularity;
  /** The calendar tick marks falling within `[min, max]`. */
  readonly ticks: readonly Tick[];
}

/** A dated thing the scale can span: anything carrying resolved start/end epoch millis. */
export interface Dated {
  /** The span start in epoch milliseconds. */
  readonly start: number;
  /** The span end in epoch milliseconds. */
  readonly end: number;
}

/** The narrowest viewport the axis will render, so zooming in cannot collapse the window. */
const MIN_WINDOW_MS = 7 * DAY_MS;
/** The widest viewport the axis will render, so zooming out stays legible. */
const MAX_WINDOW_MS = 20 * 365 * DAY_MS;
/** Fraction of the data span added as breathing room on each side of the default window. */
const DEFAULT_PAD_RATIO = 0.08;
/** How far back the default window reaches when there is nothing dated to frame. */
const EMPTY_WINDOW_BEFORE_MS = 15 * DAY_MS;
/** How far forward the default window reaches when there is nothing dated to frame. */
const EMPTY_WINDOW_AFTER_MS = 45 * DAY_MS;

/**
 * Parse a wire date (ISO date-only or full timestamp) to epoch milliseconds.
 *
 * @param value - The ISO string, or `null`/`undefined` when unset.
 * @returns the epoch-ms instant, or `null` when absent or unparseable.
 */
export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Auto-pick a sensible granularity for a viewport span.
 *
 * @remarks
 * Thresholds keep the axis roughly 6–16 ticks wide at any zoom, so the header never degenerates
 * into either a bare pair of labels or an unreadable comb.
 *
 * @param spanMs - The viewport span in milliseconds.
 * @returns the resolved granularity for that span.
 */
export function pickGranularity(spanMs: number): ResolvedGranularity {
  const days = spanMs / DAY_MS;
  if (days <= 21) return 'day';
  if (days <= 80) return 'week';
  if (days <= 750) return 'month';
  if (days <= 2200) return 'quarter';
  return 'year';
}

/**
 * The viewport span each concrete granularity is legible at, in milliseconds.
 *
 * @remarks
 * Choosing a granularity from the zoom menu is *zooming*, not merely relabelling: asking for
 * "Days" on a five-year window would draw eighteen hundred ticks the axis then has to thin away,
 * and the viewer would still be looking at five years. Each step therefore carries the window
 * width at which its ticks read comfortably (roughly 8–16 marks across the plot), and selecting it
 * re-frames the viewport to that width about its own centre. `auto` has no width — it is the
 * absence of a request, and leaves the window exactly where the viewer left it.
 */
const GRANULARITY_SPAN_MS: Record<ResolvedGranularity, number> = {
  day: 14 * DAY_MS,
  week: 70 * DAY_MS,
  month: 400 * DAY_MS,
  quarter: 1200 * DAY_MS,
  year: 8 * 365 * DAY_MS,
};

/**
 * Re-frame a window so the requested granularity renders at a legible tick density.
 *
 * @remarks
 * Preserves the window's centre, so choosing a coarser or finer unit keeps the viewer looking at
 * the same moment in the plan rather than jumping to today or to the data's first row.
 *
 * @param window - The current viewport.
 * @param requested - The requested granularity, or `'auto'` to leave the window untouched.
 * @returns the re-framed viewport, clamped to the legible zoom range.
 */
export function windowForGranularity(window: TimeWindow, requested: ViewScale): TimeWindow {
  if (requested === 'auto') return window;
  const target = GRANULARITY_SPAN_MS[requested];
  const center = window.min + (window.max - window.min) / 2;
  return clampWindow({
    min: Math.round(center - target / 2),
    max: Math.round(center + target / 2),
  });
}

/** The UTC midnight on or before `ms`. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The UTC midnight of the Monday on or before `ms` (week boundaries are ISO Mondays). */
function startOfWeek(ms: number): number {
  const utc = startOfDay(ms);
  const dow = new Date(utc).getUTCDay(); // 0=Sun … 6=Sat
  return utc - ((dow + 6) % 7) * DAY_MS;
}

/** The UTC first-of-month at or before `ms`. */
function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** The UTC first-of-quarter at or before `ms`. */
function startOfQuarter(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

/** The UTC first-of-year at or before `ms`. */
function startOfYear(ms: number): number {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}

/** Snap `ms` down to the start of its granularity period. */
export function snapDown(ms: number, g: ResolvedGranularity): number {
  if (g === 'day') return startOfDay(ms);
  if (g === 'week') return startOfWeek(ms);
  if (g === 'month') return startOfMonth(ms);
  if (g === 'quarter') return startOfQuarter(ms);
  return startOfYear(ms);
}

/** Advance `ms` by exactly one granularity period (stepping the tick cursor). */
function step(ms: number, g: ResolvedGranularity): number {
  const d = new Date(ms);
  if (g === 'day') return ms + DAY_MS;
  if (g === 'week') return ms + 7 * DAY_MS;
  if (g === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (g === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
}

/** Whether a tick opens a larger calendar unit, for the axis header's second tier. */
function isMajor(ms: number, g: ResolvedGranularity): boolean {
  const d = new Date(ms);
  if (g === 'day' || g === 'week') return d.getUTCDate() <= 7;
  // At year granularity every tick opens its own band, so a decade is the next unit up.
  if (g === 'year') return d.getUTCFullYear() % 10 === 0;
  return d.getUTCMonth() === 0;
}

/** Format a tick label for the given granularity (locale-aware via `Intl`). */
function tickLabel(ms: number, g: ResolvedGranularity): string {
  const d = new Date(ms);
  if (g === 'day' || g === 'week') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (g === 'month') {
    return d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  }
  if (g === 'year') return `${d.getUTCFullYear()}`;
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${quarter} '${`${d.getUTCFullYear() % 100}`.padStart(2, '0')}`;
}

/**
 * The label for the axis header's major band covering `ms` (the month, the year, or the decade).
 *
 * @param ms - An instant inside the band.
 * @param g - The rendered granularity.
 * @returns the band label.
 */
export function bandLabel(ms: number, g: ResolvedGranularity): string {
  const d = new Date(ms);
  if (g === 'day' || g === 'week') {
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  if (g === 'year') return `${Math.floor(d.getUTCFullYear() / 10) * 10}s`;
  return `${d.getUTCFullYear()}`;
}

/** Clamp a window to the legible zoom range, preserving its center. */
function clampWindow(window: TimeWindow): TimeWindow {
  const span = window.max - window.min;
  if (span >= MIN_WINDOW_MS && span <= MAX_WINDOW_MS) return window;
  const target = Math.min(Math.max(span, MIN_WINDOW_MS), MAX_WINDOW_MS);
  const center = window.min + span / 2;
  return { min: Math.round(center - target / 2), max: Math.round(center + target / 2) };
}

/**
 * The data extents of a set of dated items.
 *
 * @param dated - The dated items.
 * @returns the `[min, max]` extent, or `null` when nothing is dated.
 */
export function extentOf(dated: readonly Dated[]): TimeWindow | null {
  if (dated.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of dated) {
    if (item.start < min) min = item.start;
    if (item.end > max) max = item.end;
  }
  return { min, max };
}

/**
 * Build the initial, today-anchored viewport for a set of dated items.
 *
 * @remarks
 * Frames the work *and* the present: the window covers the data extents, always includes today
 * (a roadmap whose work is all in the past still shows where "today" sits relative to it), and
 * carries proportional padding so no bar starts or ends flush against an edge. With nothing dated
 * it falls back to a fixed window around today rather than collapsing to a point.
 *
 * `now` is snapped to the start of its UTC day before anything else happens. That is what makes
 * the result a function of the *date* rather than of the millisecond it was called at — the same
 * page rendered on the server and hydrated on the client produces a byte-identical axis, and two
 * viewers opening the same board see the same window. A viewport that moved with the clock also
 * made every screenshot of this surface unreproducible.
 *
 * @param dated - The dated items to frame.
 * @param now - The current instant, injected so the result is deterministic under test.
 * @returns the initial viewport.
 */
export function defaultWindow(dated: readonly Dated[], now: number): TimeWindow {
  const today = startOfDay(now);
  const extent = extentOf(dated);
  if (!extent) {
    return { min: today - EMPTY_WINDOW_BEFORE_MS, max: today + EMPTY_WINDOW_AFTER_MS };
  }
  const min = Math.min(extent.min, today);
  const max = Math.max(extent.max, today);
  const pad = Math.max((max - min) * DEFAULT_PAD_RATIO, DAY_MS);
  return clampWindow({ min: min - pad, max: max + pad });
}

/**
 * Zoom a window about a fractional anchor point.
 *
 * @remarks
 * The anchor is the fraction of the window that must stay fixed (the pointer position for a
 * wheel-zoom, `0.5` for a keyboard zoom), so zooming feels like it happens *under the cursor*
 * rather than snapping to the center.
 *
 * @param window - The current viewport.
 * @param factor - Scale applied to the span; `<1` zooms in, `>1` zooms out.
 * @param anchor - The fraction of the window (0–1) held stationary.
 * @returns the zoomed viewport, clamped to the legible range.
 */
export function zoomWindow(window: TimeWindow, factor: number, anchor: number): TimeWindow {
  const span = window.max - window.min;
  const focus = window.min + span * Math.min(Math.max(anchor, 0), 1);
  const next = span * factor;
  return clampWindow({
    min: Math.round(focus - (focus - window.min) * (next / span)),
    max: Math.round(focus + (window.max - focus) * (next / span)),
  });
}

/**
 * Pan a window by a fraction of its own span.
 *
 * @param window - The current viewport.
 * @param fraction - How far to shift, as a fraction of the span (negative pans earlier).
 * @returns the panned viewport (span preserved).
 */
export function panWindow(window: TimeWindow, fraction: number): TimeWindow {
  const delta = Math.round((window.max - window.min) * fraction);
  return { min: window.min + delta, max: window.max + delta };
}

/**
 * Build the resolved {@link TimeScale} for a viewport.
 *
 * @remarks
 * The viewport passes through **unchanged** — only the ticks are calendar-aligned. Tick generation
 * starts at the boundary at or before `min` and walks forward, keeping only marks that land inside
 * the window, and is guarded against pathological spans.
 *
 * @param window - The exact viewport.
 * @param requested - The requested granularity, or `'auto'` to derive it from the span.
 * @returns the resolved scale.
 */
export function buildScale(window: TimeWindow, requested: ViewScale): TimeScale {
  const span = Math.max(window.max - window.min, DAY_MS);
  const granularity = requested === 'auto' ? pickGranularity(span) : requested;

  const ticks: Tick[] = [];
  let cursor = snapDown(window.min, granularity);
  // An axis never needs more than a few hundred ticks; the guard bounds a pathological viewport.
  for (let guard = 0; cursor <= window.max && guard < 800; guard++) {
    if (cursor >= window.min) {
      ticks.push({
        at: cursor,
        label: tickLabel(cursor, granularity),
        major: isMajor(cursor, granularity),
      });
    }
    cursor = step(cursor, granularity);
  }

  return { granularity, min: window.min, max: window.max, ticks };
}

/**
 * Convert an epoch-ms instant to a percentage offset within a window.
 *
 * @param value - The epoch-ms position to project.
 * @param window - The viewport providing the `[min, max]` bounds.
 * @returns the offset as a percentage (0 for a degenerate window).
 */
export function pct(value: number, window: TimeWindow): number {
  const span = window.max - window.min;
  if (span <= 0) return 0;
  return ((value - window.min) / span) * 100;
}

/**
 * Convert a percentage offset back to an epoch-ms instant, snapped to a UTC day.
 *
 * @remarks
 * The inverse of {@link pct}, used by drag interactions to turn a pointer position into a date.
 * Snapping to day boundaries is what makes a drag land on a real calendar date instead of an
 * arbitrary instant, and it matches the day-resolution the wire format carries.
 *
 * @param percent - The offset as a percentage of the window.
 * @param window - The viewport providing the `[min, max]` bounds.
 * @returns the epoch-ms instant at that offset, snapped down to UTC midnight.
 */
export function dateAtPct(percent: number, window: TimeWindow): number {
  return startOfDay(window.min + ((window.max - window.min) * percent) / 100);
}

/** Human label for each granularity, for the display control. */
export const SCALE_LABEL: Record<ViewScale, string> = {
  auto: 'Auto',
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
  year: 'Years',
};
