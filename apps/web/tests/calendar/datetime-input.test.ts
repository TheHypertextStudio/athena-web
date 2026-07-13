import { describe, expect, it } from 'vitest';

import {
  fromLocalInputValue,
  localInputOccurrenceForInstant,
  toLocalInputValue,
} from '../../src/components/calendar/datetime-input';

describe('datetime-local display-zone conversion', () => {
  it('round-trips an instant through a wall value in the required display timezone', () => {
    expect(toLocalInputValue('2026-07-01T16:00:00Z', 'Asia/Tokyo')).toBe('2026-07-02T01:00');
    expect(fromLocalInputValue('2026-07-02T01:00', 'Asia/Tokyo')).toBe('2026-07-01T16:00:00Z');
  });

  it('returns null for a nonexistent display-zone wall time', () => {
    expect(fromLocalInputValue('2026-03-08T02:30', 'America/Los_Angeles')).toBeNull();
  });

  it('requires an explicit occurrence for an ambiguous display-zone wall time', () => {
    expect(fromLocalInputValue('2026-11-01T01:30', 'America/Los_Angeles')).toBeNull();
    expect(fromLocalInputValue('2026-11-01T01:30', 'America/Los_Angeles', 'earlier')).toBe(
      '2026-11-01T08:30:00Z',
    );
    expect(fromLocalInputValue('2026-11-01T01:30', 'America/Los_Angeles', 'later')).toBe(
      '2026-11-01T09:30:00Z',
    );
  });

  it('identifies an exact repeated occurrence even when the source retains seconds', () => {
    expect(localInputOccurrenceForInstant('2026-11-01T08:30:45Z', 'America/Los_Angeles')).toBe(
      'earlier',
    );
    expect(localInputOccurrenceForInstant('2026-11-01T09:30:45Z', 'America/Los_Angeles')).toBe(
      'later',
    );
  });
});
