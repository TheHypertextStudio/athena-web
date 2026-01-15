import { describe, it, expect } from 'vitest';
import {
  getTimeFromY,
  getYFromTime,
  clipEntriesToDay,
  MIN_SLOT_MINUTES,
  SELECTION_SLOT_MINUTES,
} from './calendar-utils';

describe('calendar-utils', () => {
  describe('getTimeFromY', () => {
    const baseDate = new Date('2024-03-15T00:00:00');
    const startHour = 0;
    const hourHeight = 60; // 60px per hour = 1px per minute

    it('should floor to 15-minute intervals', () => {
      // Y=0 → 0:00
      expect(getTimeFromY(0, baseDate, startHour, hourHeight).getMinutes()).toBe(0);

      // Y=7 (7 min) → floors to 0:00
      expect(getTimeFromY(7, baseDate, startHour, hourHeight).getMinutes()).toBe(0);

      // Y=14 (14 min) → floors to 0:00
      expect(getTimeFromY(14, baseDate, startHour, hourHeight).getMinutes()).toBe(0);

      // Y=15 (15 min) → 0:15
      expect(getTimeFromY(15, baseDate, startHour, hourHeight).getMinutes()).toBe(15);

      // Y=29 (29 min) → floors to 0:15
      expect(getTimeFromY(29, baseDate, startHour, hourHeight).getMinutes()).toBe(15);

      // Y=30 (30 min) → 0:30
      expect(getTimeFromY(30, baseDate, startHour, hourHeight).getMinutes()).toBe(30);

      // Y=44 (44 min) → floors to 0:30
      expect(getTimeFromY(44, baseDate, startHour, hourHeight).getMinutes()).toBe(30);

      // Y=45 (45 min) → 0:45
      expect(getTimeFromY(45, baseDate, startHour, hourHeight).getMinutes()).toBe(45);

      // Y=59 (59 min) → floors to 0:45
      expect(getTimeFromY(59, baseDate, startHour, hourHeight).getMinutes()).toBe(45);

      // Y=60 (60 min = 1 hour) → 1:00
      const result = getTimeFromY(60, baseDate, startHour, hourHeight);
      expect(result.getHours()).toBe(1);
      expect(result.getMinutes()).toBe(0);
    });

    it('should return correct hours', () => {
      // Y=120 (2 hours) → 2:00
      const result = getTimeFromY(120, baseDate, startHour, hourHeight);
      expect(result.getHours()).toBe(2);
      expect(result.getMinutes()).toBe(0);

      // Y=150 (2.5 hours) → 2:30
      const result2 = getTimeFromY(150, baseDate, startHour, hourHeight);
      expect(result2.getHours()).toBe(2);
      expect(result2.getMinutes()).toBe(30);
    });

    it('should respect startHour offset', () => {
      // With startHour=8, Y=0 → 8:00
      const result = getTimeFromY(0, baseDate, 8, hourHeight);
      expect(result.getHours()).toBe(8);
      expect(result.getMinutes()).toBe(0);

      // With startHour=8, Y=60 → 9:00
      const result2 = getTimeFromY(60, baseDate, 8, hourHeight);
      expect(result2.getHours()).toBe(9);
      expect(result2.getMinutes()).toBe(0);
    });
  });

  describe('getYFromTime', () => {
    const startHour = 0;
    const hourHeight = 60;

    it('should convert time to Y coordinate', () => {
      const time = new Date('2024-03-15T02:30:00');
      expect(getYFromTime(time, startHour, hourHeight)).toBe(150); // 2.5 hours * 60px
    });

    it('should respect startHour offset', () => {
      const time = new Date('2024-03-15T10:00:00');
      expect(getYFromTime(time, 8, hourHeight)).toBe(120); // (10-8) hours * 60px
    });

    it('should treat midnight of next day as hour 24 when reference date provided', () => {
      const referenceDate = new Date('2024-03-15T00:00:00');
      const midnight = new Date('2024-03-16T00:00:00'); // Next day at midnight

      // Without reference, midnight is hour 0
      expect(getYFromTime(midnight, startHour, hourHeight)).toBe(0);

      // With reference, midnight of next day is hour 24
      expect(getYFromTime(midnight, startHour, hourHeight, referenceDate)).toBe(1440); // 24 * 60px
    });

    it('should not treat same-day midnight as hour 24', () => {
      const referenceDate = new Date('2024-03-15T00:00:00');
      const sameDayMidnight = new Date('2024-03-15T00:00:00');

      expect(getYFromTime(sameDayMidnight, startHour, hourHeight, referenceDate)).toBe(0);
    });
  });

  describe('clipEntriesToDay', () => {
    const startHour = 0;
    const endHour = 24;

    // Helper to create dates without timezone issues
    function createDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
      const d = new Date();
      d.setFullYear(year, month - 1, day); // month is 0-indexed
      d.setHours(hour, minute, 0, 0);
      return d;
    }

    it('should pass through entries that fit within the day', () => {
      const date = createDate(2024, 3, 15);
      const entries = [
        {
          id: '1',
          type: 'event' as const,
          title: 'Meeting',
          startTime: createDate(2024, 3, 15, 10, 0),
          endTime: createDate(2024, 3, 15, 11, 0),
        },
      ];

      const result = clipEntriesToDay(entries, date, startHour, endHour);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]?.continuesFromPreviousDay).toBe(false);
      expect(result[0]?.continuesToNextDay).toBe(false);
    });

    it('should clip event that starts before day and ends within day', () => {
      const date = createDate(2024, 3, 15);
      const entries = [
        {
          id: '1',
          type: 'event' as const,
          title: 'Sleep',
          startTime: createDate(2024, 3, 14, 22, 0), // Previous day
          endTime: createDate(2024, 3, 15, 7, 0),
        },
      ];

      const result = clipEntriesToDay(entries, date, startHour, endHour);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]?.displayStartTime.getHours()).toBe(0); // Clipped to midnight
      expect(result[0]?.displayEndTime.getHours()).toBe(7);
      expect(result[0]?.continuesFromPreviousDay).toBe(true);
      expect(result[0]?.continuesToNextDay).toBe(false);
    });

    it('should clip event that starts within day and ends after day', () => {
      const date = createDate(2024, 3, 15);
      const entries = [
        {
          id: '1',
          type: 'event' as const,
          title: 'Sleep',
          startTime: createDate(2024, 3, 15, 22, 0),
          endTime: createDate(2024, 3, 16, 7, 0), // Next day
        },
      ];

      const result = clipEntriesToDay(entries, date, startHour, endHour);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeDefined();
      expect(result[0]?.displayStartTime.getHours()).toBe(22);
      // End time should be midnight of next day (hour 24 equivalent)
      expect(result[0]?.displayEndTime.getDate()).toBe(16);
      expect(result[0]?.displayEndTime.getHours()).toBe(0);
      expect(result[0]?.continuesFromPreviousDay).toBe(false);
      expect(result[0]?.continuesToNextDay).toBe(true);
    });

    it('should filter out events entirely outside the day', () => {
      const date = createDate(2024, 3, 15);
      const entries = [
        {
          id: '1',
          type: 'event' as const,
          title: 'Yesterday Event',
          startTime: createDate(2024, 3, 14, 10, 0),
          endTime: createDate(2024, 3, 14, 11, 0),
        },
        {
          id: '2',
          type: 'event' as const,
          title: 'Tomorrow Event',
          startTime: createDate(2024, 3, 16, 10, 0),
          endTime: createDate(2024, 3, 16, 11, 0),
        },
      ];

      const result = clipEntriesToDay(entries, date, startHour, endHour);
      expect(result).toHaveLength(0);
    });
  });

  describe('constants', () => {
    it('should have correct granularity values', () => {
      expect(MIN_SLOT_MINUTES).toBe(5); // Fine adjustment granularity
      expect(SELECTION_SLOT_MINUTES).toBe(15); // Initial selection granularity
    });
  });
});
