import { describe, expect, it } from 'vitest';

import { partitionScheduleRangeByContext } from '@/components/scheduling';

describe('schedule context intersections', () => {
  it('splits one range at ordered context boundaries and preserves its uncovered tail', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 9 * 60 + 30, endMinutes: 12 * 60 + 30 }, [
        { id: 'office', startMinutes: 10 * 60, endMinutes: 12 * 60 },
        { id: 'home', startMinutes: 0, endMinutes: 10 * 60 },
        { id: 'transit', startMinutes: 13 * 60, endMinutes: 14 * 60 },
      ]),
    ).toEqual([
      { contextId: 'home', startMinutes: 9 * 60 + 30, endMinutes: 10 * 60 },
      { contextId: 'office', startMinutes: 10 * 60, endMinutes: 12 * 60 },
      { contextId: null, startMinutes: 12 * 60, endMinutes: 12 * 60 + 30 },
    ]);
  });

  it('clips context regions to the requested range and excludes zero-length boundary contacts', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 60, endMinutes: 120 }, [
        { id: 'before', startMinutes: 0, endMinutes: 60 },
        { id: 'crossing', startMinutes: 30, endMinutes: 90 },
        { id: 'after', startMinutes: 120, endMinutes: 180 },
      ]),
    ).toEqual([
      { contextId: 'crossing', startMinutes: 60, endMinutes: 90 },
      { contextId: null, startMinutes: 90, endMinutes: 120 },
    ]);
  });

  it('returns one neutral segment for empty or non-overlapping context', () => {
    expect(partitionScheduleRangeByContext({ startMinutes: 300, endMinutes: 360 }, [])).toEqual([
      { contextId: null, startMinutes: 300, endMinutes: 360 },
    ]);
    expect(
      partitionScheduleRangeByContext({ startMinutes: 300, endMinutes: 360 }, [
        { id: 'later', startMinutes: 360, endMinutes: 420 },
      ]),
    ).toEqual([{ contextId: null, startMinutes: 300, endMinutes: 360 }]);
  });

  it('partitions context already clipped to both day boundaries without phantom segments', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 0, endMinutes: 24 * 60 }, [
        { id: 'day-start', startMinutes: 0, endMinutes: 30 },
        { id: 'day-end', startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 },
      ]),
    ).toEqual([
      { contextId: 'day-start', startMinutes: 0, endMinutes: 30 },
      { contextId: null, startMinutes: 30, endMinutes: 23 * 60 + 30 },
      { contextId: 'day-end', startMinutes: 23 * 60 + 30, endMinutes: 24 * 60 },
    ]);
  });
});
