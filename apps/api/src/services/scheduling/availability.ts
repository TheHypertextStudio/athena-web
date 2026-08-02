/**
 * `@docket/api` — turning a person's declared week into concrete, allocatable time.
 *
 * @remarks
 * Two ideas do the work here.
 *
 * **Protection is absolute.** A `personal` window is not a low-priority window; it is a hole
 * punched through every other kind. {@link expandAvailability} subtracts personal time from desk,
 * field and transit availability *before* the planner ever sees it, so there is no code path in
 * which a work block can land in protected time — the minutes simply do not exist in the pool.
 * Time that falls in no declared window is unavailable for the same reason.
 *
 * **Travel time is discovered, not declared.** The interesting reading time is the gap between
 * two commitments in different places — the bus ride, the wait in a lobby. {@link detectTransitGaps}
 * finds those from the day's own busy items rather than asking the user to enumerate them, which
 * is the difference between "reading is scheduled where reading actually happens" and "reading is
 * a desk block you will skip".
 */
import type { AvailabilityWindow, AvailabilityWindowKind } from '@docket/types';

import type { Interval, Span } from './intervals';
import { mergeIntervals, spanMinutes, subtractIntervals } from './intervals';
import { instantAt, localDateString, weekDates, weekdayOf } from './zoned-time';

/** A pre-existing commitment the planner must schedule around. */
export interface BusyItem {
  readonly id: string;
  readonly title: string;
  readonly start: number;
  readonly end: number;
  /** Where it happens; used to infer travel between consecutive commitments. */
  readonly location: string | null;
  /** People expected — a non-empty list is what makes an item worth debriefing. */
  readonly attendees: readonly string[];
  /** The work shape, when the item is one of ours. */
  readonly workShape: string | null;
  /** Whether this item was placed by a previous scheduler run. */
  readonly schedulerOwned: boolean;
}

/** The expanded, allocatable shape of one week. */
export interface ExpandedAvailability {
  /** Free spans by kind, with personal time and busy time already removed. */
  readonly free: readonly Span[];
  /** Declared protected windows — reported, never allocated. */
  readonly protectedMinutes: number;
  /**
   * The merged protected intervals themselves.
   *
   * @remarks
   * Exposed because protection has to survive *discovery*: a travel gap inferred from two
   * located commitments can land inside a protected lunch, and the planner must be able to cut
   * it back out. Availability is opt-in; protection is absolute.
   */
  readonly protectedIntervals: readonly Interval[];
  /** Total declared desk/field/transit minutes before busy time was subtracted. */
  readonly availableMinutes: number;
}

/** Weekday windows keyed for cheap per-date lookup. */
function windowsForWeekday(
  windows: readonly AvailabilityWindow[],
  weekday: number,
): readonly AvailabilityWindow[] {
  return windows.filter((w) => w.weekday === weekday);
}

/**
 * Expand recurring weekly windows into concrete spans for one week, minus busy time.
 *
 * @param input.weekStartDate - Local Monday.
 * @param input.timezone - IANA timezone the windows are declared in.
 * @param input.windows - The recurring weekly windows.
 * @param input.busy - Pre-existing commitments to schedule around.
 * @returns the allocatable free spans plus the week's headline minute counts.
 */
export function expandAvailability(input: {
  readonly weekStartDate: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
  readonly busy: readonly Interval[];
}): ExpandedAvailability {
  const { weekStartDate, timezone, windows, busy } = input;
  const workable: Span[] = [];
  const personal: Interval[] = [];

  for (const date of weekDates(weekStartDate)) {
    const weekday = weekdayOf(date);
    for (const window of windowsForWeekday(windows, weekday)) {
      const start = instantAt(date, window.startMinute, timezone).getTime();
      const end = instantAt(date, window.endMinute, timezone).getTime();
      if (end <= start) continue;
      if (window.kind === 'personal') personal.push({ start, end });
      else workable.push({ date, kind: window.kind, start, end });
    }
  }

  // Protection first: a work window overlapping protected time loses those minutes outright.
  const unprotected = subtractIntervals(workable, personal);
  const availableMinutes = unprotected.reduce((sum, s) => sum + spanMinutes(s), 0);
  const free = subtractIntervals(unprotected, busy);
  const protectedIntervals = mergeIntervals(personal);

  return {
    free,
    protectedMinutes: protectedIntervals.reduce((sum, i) => sum + spanMinutes(i), 0),
    protectedIntervals,
    availableMinutes,
  };
}

/**
 * Infer travel/waiting windows from consecutive located commitments.
 *
 * @remarks
 * The rule is deliberately conservative: two items on the same local day, both with a location,
 * the locations differing, and a gap between `min` and `max` minutes. A short gap is not travel
 * (you are still packing up); a very long one is not travel either (it is an afternoon). Anything
 * that qualifies becomes `transit` availability, which only interstitial shapes may consume — so
 * inferring one wrongly costs a misplaced paperback, never a misplaced shoot.
 *
 * @param input.busy - The day's commitments, in any order.
 * @param input.timezone - IANA timezone, used to group items by local day.
 * @param input.minMinutes - Shortest gap that counts as usable.
 * @param input.maxMinutes - Longest gap that still counts as travel rather than free time.
 * @returns transit spans, sorted by start.
 */
export function detectTransitGaps(input: {
  readonly busy: readonly BusyItem[];
  readonly timezone: string;
  readonly minMinutes: number;
  readonly maxMinutes: number;
}): Span[] {
  const { busy, timezone, minMinutes, maxMinutes } = input;
  const byDate = new Map<string, BusyItem[]>();
  for (const item of busy) {
    if (item.location === null || item.location.trim() === '') continue;
    const date = localDateString(new Date(item.start), timezone);
    const bucket = byDate.get(date);
    if (bucket) bucket.push(item);
    else byDate.set(date, [item]);
  }

  const gaps: Span[] = [];
  for (const [date, items] of byDate) {
    const sorted = [...items].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const prev = sorted[i];
      const next = sorted[i + 1];
      if (prev === undefined || next === undefined) continue;
      if (normalizeLocation(prev.location) === normalizeLocation(next.location)) continue;
      const gapMinutes = Math.trunc((next.start - prev.end) / 60_000);
      if (gapMinutes < minMinutes || gapMinutes > maxMinutes) continue;
      gaps.push({ date, kind: 'transit', start: prev.end, end: next.start });
    }
  }
  return gaps.sort((a, b) => a.start - b.start);
}

/** Case- and whitespace-insensitive location comparison. */
function normalizeLocation(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * The default availability model, used until a person saves their own.
 *
 * @remarks
 * A documented default, not a hidden fallback: weekday desk hours with a protected lunch,
 * weekday evenings and all of Sunday protected, Saturday given to field work, and a commute
 * window on each weekday morning and evening. It exists so the very first planning run produces
 * a real week instead of an empty one, and every value in it is visible and editable.
 */
export function defaultAvailabilityWindows(): AvailabilityWindow[] {
  const windows: AvailabilityWindow[] = [];
  const push = (
    weekday: number,
    startMinute: number,
    endMinute: number,
    kind: AvailabilityWindowKind,
    label: string,
  ): void => {
    windows.push({ weekday, startMinute, endMinute, kind, label });
  };

  for (let weekday = 1; weekday <= 5; weekday += 1) {
    push(weekday, 8 * 60, 8 * 60 + 45, 'transit', 'Morning commute');
    push(weekday, 9 * 60, 12 * 60, 'desk', 'Morning desk');
    push(weekday, 12 * 60, 13 * 60, 'personal', 'Lunch');
    push(weekday, 13 * 60, 17 * 60, 'desk', 'Afternoon desk');
    push(weekday, 17 * 60, 17 * 60 + 45, 'transit', 'Evening commute');
    push(weekday, 18 * 60, 21 * 60, 'field', 'Evening community time');
    push(weekday, 21 * 60, 23 * 60 + 59, 'personal', 'Evening off');
  }
  // Saturday is field-shaped: shoots and community work, with the evening protected.
  push(6, 9 * 60, 17 * 60, 'field', 'Saturday field work');
  push(6, 17 * 60, 23 * 60 + 59, 'personal', 'Saturday evening off');
  // Sunday is protected end to end.
  push(0, 0, 23 * 60 + 59, 'personal', 'Sunday off');
  return windows;
}
