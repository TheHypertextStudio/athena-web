/**
 * Tests for multi-day event rendering in the calendar.
 *
 * Validates that:
 * - Events spanning multiple days are clipped to day bounds
 * - Continuation flags are set correctly
 * - Display times are calculated properly for rendering
 *
 * The core rule: "if something is scheduled during some unit of time, it must be covered"
 * Example: A sleep event from 10pm Monday to 7am Tuesday must show on BOTH days.
 */

import { describe, it, expect } from 'vitest';
import { clipEntriesToDay } from '@/lib/calendar-utils';

// =============================================================================
// Test Helpers
// =============================================================================

interface TestEntry {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
}

function createEntry(
  overrides: Partial<TestEntry> & { id: string; startTime: Date; endTime: Date },
): TestEntry {
  return {
    title: 'Test Event',
    isAllDay: false,
    ...overrides,
  };
}

/**
 * Create a date representing a specific local day (without time).
 * This avoids timezone issues with Date.parse.
 */
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Create a date representing a specific local datetime.
 */
function localDateTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// =============================================================================
// clipEntriesToDay Tests
// =============================================================================

describe('clipEntriesToDay', () => {
  describe('single-day events', () => {
    it('returns single-day events unchanged', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: '1',
          title: 'Meeting',
          startTime: localDateTime(2024, 1, 16, 10, 0),
          endTime: localDateTime(2024, 1, 16, 11, 0),
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      expect(clipped.displayStartTime).toEqual(entries[0]?.startTime);
      expect(clipped.displayEndTime).toEqual(entries[0]?.endTime);
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(false);
    });

    it('preserves all original entry properties', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'custom-id',
          title: 'Custom Title',
          startTime: localDateTime(2024, 1, 16, 10, 0),
          endTime: localDateTime(2024, 1, 16, 11, 0),
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      expect(clipped.id).toBe('custom-id');
      expect(clipped.title).toBe('Custom Title');
    });
  });

  describe('multi-day events - sleep scenario', () => {
    it('clips overnight event on the first day (shows 10pm to midnight)', () => {
      const monday = localDate(2024, 1, 15);
      const entries = [
        createEntry({
          id: 'sleep',
          title: 'Sleep',
          startTime: localDateTime(2024, 1, 15, 22, 0), // Monday 10pm
          endTime: localDateTime(2024, 1, 16, 7, 0), // Tuesday 7am
        }),
      ];

      const result = clipEntriesToDay(entries, monday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      // Should show from 10pm to midnight on Monday
      expect(clipped.displayStartTime).toEqual(localDateTime(2024, 1, 15, 22, 0));
      expect(clipped.displayEndTime).toEqual(localDateTime(2024, 1, 16, 0, 0)); // Midnight = next day 00:00
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(true);
    });

    it('clips overnight event on the second day (shows midnight to 7am)', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'sleep',
          title: 'Sleep',
          startTime: localDateTime(2024, 1, 15, 22, 0), // Monday 10pm
          endTime: localDateTime(2024, 1, 16, 7, 0), // Tuesday 7am
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      // Should show from midnight to 7am on Tuesday
      expect(clipped.displayStartTime).toEqual(localDateTime(2024, 1, 16, 0, 0)); // Midnight
      expect(clipped.displayEndTime).toEqual(localDateTime(2024, 1, 16, 7, 0));
      expect(clipped.continuesFromPreviousDay).toBe(true);
      expect(clipped.continuesToNextDay).toBe(false);
    });
  });

  describe('multi-day events spanning more than 2 days', () => {
    it('clips to full day for middle days of multi-day event', () => {
      // Event spanning Monday to Wednesday
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'conference',
          title: 'Conference',
          startTime: localDateTime(2024, 1, 15, 9, 0), // Monday 9am
          endTime: localDateTime(2024, 1, 17, 18, 0), // Wednesday 6pm
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      // On Tuesday (middle day), should show full day
      expect(clipped.displayStartTime).toEqual(localDateTime(2024, 1, 16, 0, 0));
      expect(clipped.displayEndTime).toEqual(localDateTime(2024, 1, 17, 0, 0)); // end of Tuesday = midnight
      expect(clipped.continuesFromPreviousDay).toBe(true);
      expect(clipped.continuesToNextDay).toBe(true);
    });
  });

  describe('filtering behavior', () => {
    it('excludes events that do not overlap with the day', () => {
      const wednesday = localDate(2024, 1, 17);
      const entries = [
        createEntry({
          id: 'monday-event',
          title: 'Monday Event',
          startTime: localDateTime(2024, 1, 15, 10, 0),
          endTime: localDateTime(2024, 1, 15, 11, 0),
        }),
      ];

      const result = clipEntriesToDay(entries, wednesday);

      expect(result).toHaveLength(0);
    });

    it('includes events that end at midnight (edge case)', () => {
      const monday = localDate(2024, 1, 15);
      const entries = [
        createEntry({
          id: 'evening-event',
          title: 'Late Night Event',
          startTime: localDateTime(2024, 1, 15, 22, 0),
          endTime: localDateTime(2024, 1, 16, 0, 0), // Ends exactly at midnight
        }),
      ];

      const result = clipEntriesToDay(entries, monday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(false); // Ends exactly at midnight, doesn't continue
    });

    it('includes events that start at midnight (edge case)', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'early-event',
          title: 'Early Event',
          startTime: localDateTime(2024, 1, 16, 0, 0), // Starts exactly at midnight
          endTime: localDateTime(2024, 1, 16, 2, 0),
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(false);
    });
  });

  describe('all-day events', () => {
    it('passes through all-day events without clipping', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'holiday',
          title: 'Holiday',
          startTime: localDateTime(2024, 1, 16, 0, 0),
          endTime: localDateTime(2024, 1, 16, 23, 59),
          isAllDay: true,
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      expect(clipped.displayStartTime).toEqual(entries[0]?.startTime);
      expect(clipped.displayEndTime).toEqual(entries[0]?.endTime);
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(false);
    });
  });

  describe('custom start/end hours', () => {
    it('respects custom startHour for clipping', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'overnight',
          title: 'Overnight Shift',
          startTime: localDateTime(2024, 1, 15, 20, 0),
          endTime: localDateTime(2024, 1, 16, 8, 0),
        }),
      ];

      // Calendar shows 6am to 10pm (6 to 22)
      const result = clipEntriesToDay(entries, tuesday, 6, 22);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      // Should clip to start at 6am (startHour), end at 8am (actual end)
      expect(clipped.displayStartTime).toEqual(localDateTime(2024, 1, 16, 6, 0));
      expect(clipped.displayEndTime).toEqual(localDateTime(2024, 1, 16, 8, 0));
      expect(clipped.continuesFromPreviousDay).toBe(true);
      expect(clipped.continuesToNextDay).toBe(false);
    });

    it('respects custom endHour for clipping', () => {
      const monday = localDate(2024, 1, 15);
      const entries = [
        createEntry({
          id: 'overnight',
          title: 'Overnight Shift',
          startTime: localDateTime(2024, 1, 15, 20, 0),
          endTime: localDateTime(2024, 1, 16, 8, 0),
        }),
      ];

      // Calendar shows 6am to 10pm (6 to 22)
      const result = clipEntriesToDay(entries, monday, 6, 22);

      expect(result).toHaveLength(1);
      const clipped = result[0];
      expect(clipped).toBeDefined();
      if (!clipped) return;
      // Should clip to start at 8pm (actual start), end at 10pm (endHour)
      expect(clipped.displayStartTime).toEqual(localDateTime(2024, 1, 15, 20, 0));
      expect(clipped.displayEndTime).toEqual(localDateTime(2024, 1, 15, 22, 0));
      expect(clipped.continuesFromPreviousDay).toBe(false);
      expect(clipped.continuesToNextDay).toBe(true);
    });
  });

  describe('multiple overlapping events', () => {
    it('correctly clips multiple events for the same day', () => {
      const tuesday = localDate(2024, 1, 16);
      const entries = [
        createEntry({
          id: 'sleep',
          title: 'Sleep',
          startTime: localDateTime(2024, 1, 15, 22, 0),
          endTime: localDateTime(2024, 1, 16, 7, 0),
        }),
        createEntry({
          id: 'meeting',
          title: 'Meeting',
          startTime: localDateTime(2024, 1, 16, 10, 0),
          endTime: localDateTime(2024, 1, 16, 11, 0),
        }),
        createEntry({
          id: 'dinner',
          title: 'Dinner',
          startTime: localDateTime(2024, 1, 16, 19, 0),
          endTime: localDateTime(2024, 1, 16, 21, 0),
        }),
      ];

      const result = clipEntriesToDay(entries, tuesday);

      expect(result).toHaveLength(3);

      // Sleep - continues from previous day
      const sleep = result.find((e) => e.id === 'sleep');
      expect(sleep).toBeDefined();
      if (!sleep) return;
      expect(sleep.continuesFromPreviousDay).toBe(true);
      expect(sleep.continuesToNextDay).toBe(false);

      // Meeting - normal event
      const meeting = result.find((e) => e.id === 'meeting');
      expect(meeting).toBeDefined();
      if (!meeting) return;
      expect(meeting.continuesFromPreviousDay).toBe(false);
      expect(meeting.continuesToNextDay).toBe(false);

      // Dinner - normal event
      const dinner = result.find((e) => e.id === 'dinner');
      expect(dinner).toBeDefined();
      if (!dinner) return;
      expect(dinner.continuesFromPreviousDay).toBe(false);
      expect(dinner.continuesToNextDay).toBe(false);
    });
  });
});
