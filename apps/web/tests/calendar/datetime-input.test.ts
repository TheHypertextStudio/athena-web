import { describe, expect, it } from 'vitest';

import {
  fromLocalInputValue,
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

  it('returns null for an ambiguous repeated display-zone wall time', () => {
    expect(fromLocalInputValue('2026-11-01T01:30', 'America/Los_Angeles')).toBeNull();
  });
});
