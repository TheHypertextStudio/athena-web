/**
 * The timer's two number formats.
 *
 * @remarks
 * Pure display logic, and the one place a wrong answer is silently plausible: a clock that
 * changes width mid-tick or a report that rounds a 90-second stretch to "0m" both look fine in a
 * screenshot and are both wrong. These cases pin the width discipline and the rounding.
 */
import { describe, expect, it } from 'vitest';

import {
  formatClock,
  formatDuration,
  spokenDuration,
} from '@/components/time-tracking/format-duration';

describe('formatClock', () => {
  it('keeps a fixed width under an hour so a ticking timer never shifts its neighbours', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9_000)).toBe('00:09');
    expect(formatClock(59_000)).toBe('00:59');
    expect(formatClock(60_000)).toBe('01:00');
    expect(formatClock(599_000)).toBe('09:59');
    expect(formatClock(600_000)).toBe('10:00');
    // Every value under an hour is exactly five characters wide.
    for (const ms of [0, 1_000, 61_000, 599_000, 3_599_000]) {
      expect(formatClock(ms)).toHaveLength(5);
    }
  });

  it('adds the hour only once there is one', () => {
    expect(formatClock(3_599_000)).toBe('59:59');
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_661_000)).toBe('1:01:01');
    expect(formatClock(36_000_000)).toBe('10:00:00');
  });

  it('never shows a negative clock when a device clock jumps backwards', () => {
    expect(formatClock(-5_000)).toBe('00:00');
  });
});

describe('formatDuration', () => {
  it('rounds to the nearest minute rather than truncating', () => {
    // 90 seconds is nearer two minutes than one; truncation would report "1m" and, worse,
    // report "0m" for anything under sixty seconds that was genuinely worked.
    expect(formatDuration(90_000)).toBe('2m');
    expect(formatDuration(31_000)).toBe('1m');
    expect(formatDuration(29_000)).toBe('0m');
  });

  it('reads as hours and minutes, dropping an empty minute part', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(48 * 60_000)).toBe('48m');
    expect(formatDuration(60 * 60_000)).toBe('1h');
    expect(formatDuration(432 * 60_000)).toBe('7h 12m');
  });

  it('reports a measured zero rather than nothing', () => {
    expect(formatDuration(0)).not.toBe('');
  });
});

describe('spokenDuration', () => {
  it('says the units out loud for assistive technology', () => {
    expect(spokenDuration(0)).toBe('0 minutes');
    expect(spokenDuration(60_000)).toBe('1 minute');
    expect(spokenDuration(3_600_000)).toBe('1 hour');
    expect(spokenDuration(432 * 60_000)).toBe('7 hours 12 minutes');
  });
});
