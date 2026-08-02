/**
 * `@docket/api` — the interval algebra the weekly planner allocates against.
 *
 * @remarks
 * Every placement decision in the planner reduces to the same three operations: subtract what is
 * already taken, find the first remaining run big enough, and mark it taken. Keeping that algebra
 * in one small, pure module means the planner never open-codes an overlap test — which is where
 * schedulers grow their double-booking bugs.
 *
 * A {@link Span} is a half-open `[start, end)` interval in epoch milliseconds, carrying the local
 * date and window kind it came from so a placement can be attributed without a second lookup.
 */
import type { AvailabilityWindowKind } from '@docket/types';

/** A half-open `[start, end)` run of time in epoch milliseconds. */
export interface Span {
  /** Local `YYYY-MM-DD` the run belongs to. */
  readonly date: string;
  /** The kind of availability this run offers. */
  readonly kind: AvailabilityWindowKind;
  /** Inclusive start, epoch ms. */
  readonly start: number;
  /** Exclusive end, epoch ms. */
  readonly end: number;
}

/** A bare `[start, end)` run with no provenance — what busy time is expressed as. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** Minutes in a span, truncated. */
export function spanMinutes(span: Interval): number {
  return Math.trunc((span.end - span.start) / 60_000);
}

/** Whether two half-open intervals share any time at all. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Merge overlapping and touching intervals into a minimal sorted set.
 *
 * @param intervals - Any intervals, in any order.
 * @returns a sorted, non-overlapping cover of the same time.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.start <= last.end) {
      if (next.end > last.end) merged[merged.length - 1] = { start: last.start, end: next.end };
    } else {
      merged.push({ start: next.start, end: next.end });
    }
  }
  return merged;
}

/**
 * Remove every part of `blockers` from `spans`, preserving each span's provenance.
 *
 * @param spans - The spans to cut.
 * @param blockers - Time that is unavailable.
 * @returns the remaining spans, sorted by start.
 */
export function subtractIntervals(spans: readonly Span[], blockers: readonly Interval[]): Span[] {
  const cuts = mergeIntervals(blockers);
  const out: Span[] = [];
  for (const span of spans) {
    let cursor = span.start;
    for (const cut of cuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= span.end) break;
      if (cut.start > cursor) out.push({ ...span, start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= span.end) break;
    }
    if (cursor < span.end) out.push({ ...span, start: cursor, end: span.end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A mutable set of free spans that hands out placements and never hands the same minute twice.
 *
 * @remarks
 * The planner holds exactly one of these for a whole run. Allocation is first-fit over spans
 * sorted by start, which for a day-shaped problem produces an earliest-possible schedule — the
 * behaviour a person expects ("why is my writing block at 4pm when the morning was empty?").
 */
export class SpanPool {
  #spans: Span[];

  /**
   * Build a pool from an initial free set.
   *
   * @param spans - The initially free spans; copied and sorted, never aliased.
   */
  constructor(spans: readonly Span[]) {
    this.#spans = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  }

  /** The remaining free spans, sorted by start. */
  get spans(): readonly Span[] {
    return this.#spans;
  }

  /** Total free minutes remaining, optionally restricted to one window kind. */
  remainingMinutes(kind?: AvailabilityWindowKind): number {
    return this.#spans
      .filter((s) => kind === undefined || s.kind === kind)
      .reduce((sum, s) => sum + spanMinutes(s), 0);
  }

  /**
   * Take the first run of at least `minutes` matching the predicate.
   *
   * @param minutes - Length to take, in minutes.
   * @param options.kind - Restrict to one window kind.
   * @param options.notBefore - Only consider time at or after this instant (epoch ms).
   * @param options.date - Restrict to one local date.
   * @param options.excludeDates - Local dates to skip, used to spread a commitment across the week.
   * @param options.reserveAfterMinutes - Extra minutes consumed immediately after the block
   *   (teardown, travel, reset) so nothing else can claim them.
   * @param options.requireTrailingMinutes - Minutes that must remain free after the reserve
   *   inside the same span, but are NOT consumed. Used to guarantee a block that needs a
   *   follow-on (a meeting and its debrief) lands somewhere both actually fit.
   * @returns the taken span, or null when nothing fits.
   */
  take(
    minutes: number,
    options: {
      readonly kind?: AvailabilityWindowKind;
      readonly notBefore?: number;
      readonly date?: string;
      readonly excludeDates?: ReadonlySet<string>;
      readonly reserveAfterMinutes?: number;
      readonly requireTrailingMinutes?: number;
    } = {},
  ): Span | null {
    const needed = minutes * 60_000;
    const reserve = (options.reserveAfterMinutes ?? 0) * 60_000;
    const trailing = (options.requireTrailingMinutes ?? 0) * 60_000;
    for (let i = 0; i < this.#spans.length; i += 1) {
      const span = this.#spans[i];
      if (span === undefined) continue;
      if (options.kind !== undefined && span.kind !== options.kind) continue;
      if (options.date !== undefined && span.date !== options.date) continue;
      if (options.excludeDates?.has(span.date) === true) continue;
      const start = Math.max(span.start, options.notBefore ?? span.start);
      if (start + needed > span.end) continue;
      if (trailing > 0 && start + needed + reserve + trailing > span.end) continue;
      // The buffer may run past the end of the span: it protects the block, it is not the block.
      const consumedEnd = Math.min(span.end, start + needed + reserve);
      const taken: Span = { date: span.date, kind: span.kind, start, end: start + needed };
      this.#replace(i, span, start, consumedEnd);
      return taken;
    }
    return null;
  }

  /**
   * Take exactly `[start, start + minutes)` if that whole run is still free.
   *
   * @remarks
   * The "leave it where it is" primitive. A re-cut of a day asks this first for every block, so
   * a block whose slot survived keeps it and is never reported as moved — which is what stops a
   * reorganization from rearranging a day that did not actually need rearranging.
   *
   * @param start - Exact start instant, epoch ms.
   * @param minutes - Length to take.
   * @returns the taken span, or null when any part of it is already claimed.
   */
  takeAt(start: number, minutes: number): Span | null {
    const end = start + minutes * 60_000;
    for (let i = 0; i < this.#spans.length; i += 1) {
      const span = this.#spans[i];
      if (span === undefined) continue;
      if (span.start > start || span.end < end) continue;
      const taken: Span = { date: span.date, kind: span.kind, start, end };
      this.#replace(i, span, start, end);
      return taken;
    }
    return null;
  }

  /**
   * Take the longest available run, up to `maxMinutes`, matching the predicate.
   *
   * @remarks
   * Used by backfill, whose job is specifically to attack the *largest* remaining hole rather
   * than the earliest one.
   *
   * @param maxMinutes - Cap on how much to take.
   * @param minMinutes - Below this, do not bother.
   * @param options.kind - Restrict to one window kind.
   * @returns the taken span, or null when nothing qualifies.
   */
  takeLongest(
    maxMinutes: number,
    minMinutes: number,
    options: { readonly kind?: AvailabilityWindowKind } = {},
  ): Span | null {
    let bestIndex = -1;
    let bestMinutes = 0;
    for (let i = 0; i < this.#spans.length; i += 1) {
      const span = this.#spans[i];
      if (span === undefined) continue;
      if (options.kind !== undefined && span.kind !== options.kind) continue;
      const mins = spanMinutes(span);
      if (mins > bestMinutes) {
        bestMinutes = mins;
        bestIndex = i;
      }
    }
    if (bestIndex < 0 || bestMinutes < minMinutes) return null;
    const span = this.#spans[bestIndex];
    /* v8 ignore next -- @preserve defensive: bestIndex is only set from a defined element */
    if (span === undefined) return null;
    const takeMins = Math.min(maxMinutes, bestMinutes);
    const end = span.start + takeMins * 60_000;
    const taken: Span = { date: span.date, kind: span.kind, start: span.start, end };
    this.#replace(bestIndex, span, span.start, end);
    return taken;
  }

  /** Replace span `index` with whatever remains of it after `[start, end)` is consumed. */
  #replace(index: number, span: Span, start: number, end: number): void {
    const remainder: Span[] = [];
    if (start > span.start) remainder.push({ ...span, end: start });
    if (end < span.end) remainder.push({ ...span, start: end });
    this.#spans.splice(index, 1, ...remainder);
  }
}
