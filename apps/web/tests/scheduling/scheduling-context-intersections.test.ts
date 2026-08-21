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

  it('gives an earlier-starting region deterministic precedence across an overlap', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 0, endMinutes: 120 }, [
        { id: 'later', startMinutes: 30, endMinutes: 90 },
        { id: 'earlier', startMinutes: -30, endMinutes: 60 },
      ]),
    ).toEqual([
      { contextId: 'earlier', startMinutes: 0, endMinutes: 60 },
      { contextId: 'later', startMinutes: 60, endMinutes: 90 },
      { contextId: null, startMinutes: 90, endMinutes: 120 },
    ]);
  });

  it('breaks equal-start ties by earliest end and then opaque identifier', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 0, endMinutes: 120 }, [
        { id: 'z-long', startMinutes: 0, endMinutes: 90 },
        { id: 'b-short', startMinutes: 0, endMinutes: 60 },
        { id: 'a-short', startMinutes: 0, endMinutes: 60 },
      ]),
    ).toEqual([
      { contextId: 'a-short', startMinutes: 0, endMinutes: 60 },
      { contextId: 'z-long', startMinutes: 60, endMinutes: 90 },
      { contextId: null, startMinutes: 90, endMinutes: 120 },
    ]);
  });

  it.each([
    { startMinutes: Number.NaN, endMinutes: 60 },
    { startMinutes: 0, endMinutes: Number.POSITIVE_INFINITY },
    { startMinutes: 60, endMinutes: 60 },
    { startMinutes: 90, endMinutes: 60 },
  ])('returns no segments for invalid requested bounds $startMinutes:$endMinutes', (bounds) => {
    expect(partitionScheduleRangeByContext(bounds, [])).toEqual([]);
  });

  it('ignores invalid and non-finite context regions', () => {
    expect(
      partitionScheduleRangeByContext({ startMinutes: 0, endMinutes: 60 }, [
        { id: 'nan', startMinutes: Number.NaN, endMinutes: 30 },
        { id: 'infinite', startMinutes: 0, endMinutes: Number.POSITIVE_INFINITY },
        { id: 'empty', startMinutes: 15, endMinutes: 15 },
        { id: 'reversed', startMinutes: 45, endMinutes: 30 },
      ]),
    ).toEqual([{ contextId: null, startMinutes: 0, endMinutes: 60 }]);
  });
});
