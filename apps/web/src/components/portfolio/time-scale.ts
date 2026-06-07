/**
 * The adaptive time scale for the Hub Portfolio roadmap.
 *
 * @remarks
 * The portfolio is one shared horizontal timeline across every org the caller belongs to.
 * Its axis is derived entirely from the dated Project bars in view: we span the earliest
 * start to the latest target, then snap the bounds out to clean boundaries for the chosen
 * granularity so the first and last bars never kiss the edges and every tick lands on a
 * natural calendar mark (a Monday for weeks, a 1st for months, a quarter start for quarters).
 *
 * The granularity is *auto-picked* from the visible span (short spans read in weeks, a few
 * quarters in months, multi-year roadmaps in quarters), but the page exposes a manual
 * override; {@link buildScale} takes a {@link Granularity} of `'auto'` plus the bars and
 * resolves everything — the effective granularity, the snapped `[min, max]` window in epoch
 * millis, and the tick marks — so the view stays declarative and the layout math lives here.
 *
 * Offsets are emitted as 0–100 percentages of the window ({@link pct}) so bars and gridlines
 * lay out responsively against whatever pixel width the scroll container ends up at.
 */

/** One day in milliseconds — the floor for span math and single-date bars. */
const DAY_MS = 86_400_000;

/** The time granularities the axis can render at. `auto` defers to {@link pickGranularity}. */
export type Granularity = 'auto' | 'week' | 'month' | 'quarter';

/** A concrete (non-auto) granularity — what the axis actually renders at. */
export type ResolvedGranularity = Exclude<Granularity, 'auto'>;

/** A single axis tick: its epoch-ms position and its already-formatted label. */
export interface Tick {
  /** The tick's position in epoch milliseconds. */
  readonly at: number;
  /** The pre-formatted, granularity-appropriate label (e.g. `Jun`, `Q3 '26`). */
  readonly label: string;
}

/** The resolved scale: the effective granularity, the window bounds, and the tick marks. */
export interface TimeScale {
  /** The granularity actually rendered (auto resolved to a concrete value). */
  readonly granularity: ResolvedGranularity;
  /** The window lower bound in epoch milliseconds (snapped to a granularity boundary). */
  readonly min: number;
  /** The window upper bound in epoch milliseconds (snapped to a granularity boundary). */
  readonly max: number;
  /** The tick marks spanning `[min, max]`, one per granularity boundary. */
  readonly ticks: readonly Tick[];
}

/** A dated thing the scale can span: anything carrying resolved start/end epoch millis. */
export interface Dated {
  /** The span start in epoch milliseconds. */
  readonly start: number;
  /** The span end in epoch milliseconds. */
  readonly end: number;
}

/**
 * Auto-pick a sensible granularity for a span.
 *
 * @remarks
 * Thresholds are chosen so the axis lands roughly 6–16 ticks wide at any zoom: spans up to
 * ~10 weeks read in weeks, up to ~2 years in months, and anything longer in quarters.
 *
 * @param spanMs - The visible span in milliseconds.
 * @returns the resolved granularity for that span.
 */
export function pickGranularity(spanMs: number): ResolvedGranularity {
  const days = spanMs / DAY_MS;
  if (days <= 80) return 'week';
  if (days <= 750) return 'month';
  return 'quarter';
}

/** The UTC midnight of the Monday on or before `ms` (week boundaries are ISO Mondays). */
function startOfWeek(ms: number): number {
  const d = new Date(ms);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(utc).getUTCDay(); // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7;
  return utc - backToMonday * DAY_MS;
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

/** Snap `ms` down to the start of its granularity period. */
function snapDown(ms: number, g: ResolvedGranularity): number {
  if (g === 'week') return startOfWeek(ms);
  if (g === 'month') return startOfMonth(ms);
  return startOfQuarter(ms);
}

/** Advance `ms` by exactly one granularity period (stepping the tick cursor). */
function step(ms: number, g: ResolvedGranularity): number {
  const d = new Date(ms);
  if (g === 'week') return ms + 7 * DAY_MS;
  if (g === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
}

/** Format a tick label for the given granularity (locale-aware via `Intl`). */
function tickLabel(ms: number, g: ResolvedGranularity): string {
  const d = new Date(ms);
  if (g === 'week') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  if (g === 'month') {
    return d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  }
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  const year = `${d.getUTCFullYear() % 100}`.padStart(2, '0');
  return `Q${quarter} '${year}`;
}

/**
 * Build the resolved {@link TimeScale} for a set of dated items.
 *
 * @remarks
 * Returns null when nothing is dated (the caller then omits the axis entirely). When
 * `requested` is `'auto'` the granularity is picked from the raw span before snapping; an
 * explicit granularity is honored as-is. The window is snapped *out* on both ends to clean
 * granularity boundaries, guaranteeing the axis is at least one period wide.
 *
 * @param dated - The dated items (project bars) to span.
 * @param requested - The requested granularity, or `'auto'` to derive it from the span.
 * @returns the resolved scale, or null when there is nothing dated to place.
 */
export function buildScale(dated: readonly Dated[], requested: Granularity): TimeScale | null {
  if (dated.length === 0) return null;
  let rawMin = Number.POSITIVE_INFINITY;
  let rawMax = Number.NEGATIVE_INFINITY;
  for (const item of dated) {
    if (item.start < rawMin) rawMin = item.start;
    if (item.end > rawMax) rawMax = item.end;
  }

  const granularity =
    requested === 'auto' ? pickGranularity(Math.max(rawMax - rawMin, DAY_MS)) : requested;

  const min = snapDown(rawMin, granularity);
  // Snap the upper bound out: step from the period containing rawMax to its *next* boundary.
  let max = step(snapDown(rawMax, granularity), granularity);
  if (max <= min) max = step(min, granularity);

  const ticks: Tick[] = [];
  let cursor = min;
  // Guard the loop against pathological inputs; an axis never needs more than a few hundred ticks.
  for (let guard = 0; cursor <= max && guard < 600; guard++) {
    ticks.push({ at: cursor, label: tickLabel(cursor, granularity) });
    cursor = step(cursor, granularity);
  }

  return { granularity, min, max, ticks };
}

/**
 * Convert an epoch-ms value to a 0–100 percentage offset within a scale's window.
 *
 * @param value - The epoch-ms position to project.
 * @param scale - The resolved scale providing the `[min, max]` window.
 * @returns the offset as a percentage (clamped to a non-negative span).
 */
export function pct(value: number, scale: Pick<TimeScale, 'min' | 'max'>): number {
  const span = scale.max - scale.min;
  if (span <= 0) return 0;
  return ((value - scale.min) / span) * 100;
}

/** Human label for a granularity, for the override control. */
export const GRANULARITY_LABEL: Record<Granularity, string> = {
  auto: 'Auto',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
};
