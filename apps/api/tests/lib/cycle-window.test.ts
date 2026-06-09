/**
 * `@docket/api` — pure cycle auto-roll math: week-alignment, cadence stepping, stable
 * numbering, and current-by-date (`lib/cycle-window.ts`). No DB, no Hono.
 */
import { describe, expect, it } from 'vitest';

import {
  type CycleWindowSlot,
  isWithinWindow,
  normalizeCadenceWeeks,
  rollingWindow,
  WINDOW_FUTURE,
  WINDOW_PAST,
} from '../../src/lib/cycle-window';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The slot whose window contains `now`. */
function currentSlot(slots: CycleWindowSlot[], now: Date): CycleWindowSlot {
  const found = slots.find((s) => isWithinWindow(now, s.startsAt, s.endsAt));
  if (!found) throw new Error('no current slot');
  return found;
}

describe('normalizeCadenceWeeks', () => {
  it('keeps a sane positive integer', () => {
    expect(normalizeCadenceWeeks(1)).toBe(1);
    expect(normalizeCadenceWeeks(2)).toBe(2);
    expect(normalizeCadenceWeeks(4)).toBe(4);
  });

  it('floors fractional cadences', () => {
    expect(normalizeCadenceWeeks(2.9)).toBe(2);
  });

  it('guards zero / negative / non-finite to weekly', () => {
    expect(normalizeCadenceWeeks(0)).toBe(1);
    expect(normalizeCadenceWeeks(-3)).toBe(1);
    expect(normalizeCadenceWeeks(Number.NaN)).toBe(1);
    expect(normalizeCadenceWeeks(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('rollingWindow', () => {
  it('returns a fixed-size window (past + current + future) ordered ascending', () => {
    const slots = rollingWindow(new Date('2026-06-08T12:00:00.000Z'), 1);
    expect(slots).toHaveLength(WINDOW_PAST + 1 + WINDOW_FUTURE);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i]!.startsAt.getTime()).toBeGreaterThan(slots[i - 1]!.startsAt.getTime());
    }
  });

  it('aligns every window start to a Monday 00:00 UTC for the weekly cadence', () => {
    const slots = rollingWindow(new Date('2026-06-08T12:00:00.000Z'), 1);
    for (const s of slots) {
      expect(s.startsAt.getUTCDay()).toBe(1); // Monday
      expect(s.startsAt.getUTCHours()).toBe(0);
      expect(s.startsAt.getUTCMinutes()).toBe(0);
      expect(s.startsAt.getUTCSeconds()).toBe(0);
      expect(s.startsAt.getUTCMilliseconds()).toBe(0);
    }
  });

  it('steps weekly windows 7 days apart, end one ms before the next start (non-overlapping)', () => {
    const slots = rollingWindow(new Date('2026-06-08T12:00:00.000Z'), 1);
    for (let i = 1; i < slots.length; i += 1) {
      const prev = slots[i - 1]!;
      const cur = slots[i]!;
      expect(cur.startsAt.getTime() - prev.startsAt.getTime()).toBe(WEEK_MS);
      // Tiling: the previous window ends exactly one ms before this one opens.
      expect(cur.startsAt.getTime() - prev.endsAt.getTime()).toBe(1);
    }
  });

  it('steps by the configured cadence (2-week windows are 14 days apart)', () => {
    const slots = rollingWindow(new Date('2026-06-08T12:00:00.000Z'), 2);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i]!.startsAt.getTime() - slots[i - 1]!.startsAt.getTime()).toBe(2 * WEEK_MS);
    }
    // A 2-week window spans 14 days minus one ms.
    const span = slots[0]!.endsAt.getTime() - slots[0]!.startsAt.getTime();
    expect(span).toBe(2 * WEEK_MS - 1);
  });

  it('places "today" inside exactly one window', () => {
    const now = new Date('2026-06-08T12:00:00.000Z'); // a Monday
    const slots = rollingWindow(now, 1);
    const matches = slots.filter((s) => isWithinWindow(now, s.startsAt, s.endsAt));
    expect(matches).toHaveLength(1);
    const cur = matches[0]!;
    expect(now.getTime()).toBeGreaterThanOrEqual(cur.startsAt.getTime());
    expect(now.getTime()).toBeLessThanOrEqual(cur.endsAt.getTime());
  });

  it('numbers windows stably and monotonically regardless of the reference instant', () => {
    const a = rollingWindow(new Date('2026-06-08T00:00:00.000Z'), 1);
    // A reference one week later: the windows shift by one, but a window covering the
    // SAME calendar dates keeps the SAME number (epoch-anchored, not now-anchored).
    const b = rollingWindow(new Date('2026-06-15T00:00:00.000Z'), 1);

    // Numbers are gap-free and ascending within a window.
    for (let i = 1; i < a.length; i += 1) {
      expect(a[i]!.number - a[i - 1]!.number).toBe(1);
    }

    // The window that both reference instants share (a's current is b's prior) keeps its
    // number across the two computations.
    const aCur = currentSlot(a, new Date('2026-06-08T00:00:00.000Z'));
    const bMatch = b.find((s) => s.startsAt.getTime() === aCur.startsAt.getTime());
    expect(bMatch).toBeDefined();
    expect(bMatch!.number).toBe(aCur.number);
  });

  it('produces positive cycle numbers for present-day windows', () => {
    const slots = rollingWindow(new Date('2026-06-08T12:00:00.000Z'), 1);
    for (const s of slots) expect(s.number).toBeGreaterThan(0);
  });
});

describe('isWithinWindow', () => {
  const start = new Date('2026-06-08T00:00:00.000Z');
  const end = new Date('2026-06-14T23:59:59.999Z');

  it('is inclusive on both boundaries', () => {
    expect(isWithinWindow(start, start, end)).toBe(true);
    expect(isWithinWindow(end, start, end)).toBe(true);
  });

  it('rejects instants outside the window', () => {
    expect(isWithinWindow(new Date('2026-06-07T23:59:59.999Z'), start, end)).toBe(false);
    expect(isWithinWindow(new Date('2026-06-15T00:00:00.000Z'), start, end)).toBe(false);
  });
});
