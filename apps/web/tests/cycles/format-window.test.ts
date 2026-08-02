/**
 * The Cycles window helpers — range formatting and whole-day arithmetic.
 *
 * @remarks
 * Two real defects are pinned here, both visible in the shipped UI:
 *
 * 1. The list row rendered "Jul 26 – Aug 2" for a cycle whose properties panel rendered
 *    "Jul 27, 2026" — one record, two start dates on one screen — because the row formatted a UTC
 *    instant with a local-zone formatter. {@link formatWindow} now delegates to the shared,
 *    UTC-pinned `defaultCycleName`, so there is exactly one implementation.
 * 2. The detail banner read "Day 6 of 8" for a **7**-day window, because `endsAt` is one
 *    millisecond before the next window opens and an elapsed-millisecond difference rounds up.
 *    {@link windowDays} now counts UTC calendar days.
 * 3. The Cycles list and the cycle detail page each phrased the runway themselves, and disagreed:
 *    on the last day of the same cycle the list said `Day 7 of 7 · last day` while the detail
 *    masthead said `Day 6 of 7 · 1 day left`. {@link windowRunway} is now the only implementation
 *    and both surfaces call it.
 */
import { describe, expect, it } from 'vitest';

import { runwayLabel } from '../../src/components/cycles/active-cycle-overview';
import {
  formatWindow,
  windowDays,
  windowProgress,
  windowRunway,
} from '../../src/components/cycles/format-window';

/** The auto-rolled weekly window shape: UTC midnight to one millisecond before the next opens. */
const START = '2026-07-27T00:00:00.000Z';
const END = '2026-08-02T23:59:59.999Z';

describe('formatWindow', () => {
  it('anchors the range to UTC calendar days', () => {
    expect(formatWindow(START, END)).toBe('Jul 27 – Aug 2');
  });

  it('never renders the day before the UTC start', () => {
    // The old local-zone formatter produced "Jul 26" everywhere west of Greenwich.
    expect(formatWindow(START, END)).not.toContain('Jul 26');
  });

  it('carries the year on a window that crosses a year boundary', () => {
    expect(formatWindow('2026-12-28T00:00:00.000Z', '2027-01-03T23:59:59.999Z')).toBe(
      'Dec 28, 2026 – Jan 3, 2027',
    );
  });

  it('formats a hand-created date-only window identically', () => {
    expect(formatWindow('2026-07-01', '2026-07-07')).toBe('Jul 1 – Jul 7');
  });
});

describe('windowDays', () => {
  it('counts an auto-rolled weekly window as 7 days, not 8', () => {
    expect(windowDays(START, END)).toBe(7);
  });

  it('counts a hand-created inclusive week as 7 days too', () => {
    expect(windowDays('2026-07-01T00:00:00.000Z', '2026-07-07T00:00:00.000Z')).toBe(7);
  });

  it('counts a single-day window as 1', () => {
    expect(windowDays('2026-07-27T00:00:00.000Z', '2026-07-27T23:59:59.999Z')).toBe(1);
  });

  it('never returns less than 1, even for an inverted window', () => {
    expect(windowDays(END, START)).toBe(1);
  });

  it('spans a month boundary by calendar day', () => {
    expect(windowDays('2026-07-30T00:00:00.000Z', '2026-08-12T23:59:59.999Z')).toBe(14);
  });
});

describe('windowProgress', () => {
  it('reports day 0 elapsed of 7 on the first day', () => {
    const win = windowProgress(START, END, new Date('2026-07-27T09:00:00.000Z'));
    expect(win.elapsedDays).toBe(0);
    expect(win.totalDays).toBe(7);
    expect(win.remainingDays).toBe(7);
    expect(win.notStarted).toBe(false);
    expect(win.ended).toBe(false);
  });

  it('reports 4 days elapsed of 7 midway through', () => {
    const win = windowProgress(START, END, new Date('2026-07-31T12:00:00.000Z'));
    expect(win.elapsedDays).toBe(4);
    expect(win.totalDays).toBe(7);
    expect(win.remainingDays).toBe(3);
  });

  it('clamps elapsed days to the window total once past the end', () => {
    const win = windowProgress(START, END, new Date('2026-09-01T00:00:00.000Z'));
    expect(win.elapsedDays).toBe(7);
    expect(win.remainingDays).toBe(0);
    expect(win.fraction).toBe(1);
    expect(win.ended).toBe(true);
  });

  it('clamps elapsed days to zero before the window opens', () => {
    const win = windowProgress(START, END, new Date('2026-07-01T00:00:00.000Z'));
    expect(win.elapsedDays).toBe(0);
    expect(win.fraction).toBe(0);
    expect(win.notStarted).toBe(true);
  });
});

describe('windowRunway', () => {
  /** The runway for this window as of `now`, taken the way the detail masthead takes it. */
  const runway = (now: string): string => windowRunway(windowProgress(START, END, new Date(now)));

  it('numbers the first day as day 1, never day 0', () => {
    expect(runway('2026-07-27T09:00:00.000Z')).toBe('Day 1 of 7 · 6 days left');
  });

  it('counts only the days still ahead midway through', () => {
    expect(runway('2026-07-31T12:00:00.000Z')).toBe('Day 5 of 7 · 2 days left');
  });

  it('calls the final day the last day rather than "1 day left"', () => {
    expect(runway('2026-08-02T09:00:00.000Z')).toBe('Day 7 of 7 · last day');
  });

  it('has its own sentence before the window opens', () => {
    expect(runway('2026-07-24T00:00:00.000Z')).toBe('Starts in 7 days');
  });

  it('has its own sentence once the window has closed', () => {
    expect(runway('2026-08-20T00:00:00.000Z')).toBe('Wrapped · ran 7 days');
  });

  it('says the same thing to the list overview and to the detail masthead', () => {
    // The regression this pins: the list reached for `runwayLabel(startsAt, endsAt)` and the detail
    // page for its own `cycleRunway(progress)`, and on the last day of a cycle the two printed
    // different sentences about the same record. Every instant in the window must agree now.
    for (const day of ['07-27', '07-28', '07-29', '07-30', '07-31', '08-01', '08-02'] as const) {
      const at = `2026-${day}T15:00:00.000Z`;
      expect(runwayLabel(START, END, new Date(at))).toBe(
        windowRunway(windowProgress(START, END, new Date(at))),
      );
    }
    // …and specifically on the last day, where they used to differ by a whole day.
    expect(runwayLabel(START, END, new Date('2026-08-02T09:00:00.000Z'))).toBe(
      'Day 7 of 7 · last day',
    );
  });
});
