import { describe, expect, it } from 'vitest';
import {
  calculateWorkload,
  type WorkloadSource,
  type WorkloadTask,
} from '../../src/workload/calculations';

const start = Date.parse('2026-10-14T00:00:00Z');
const hour = 3_600_000;
const work = (id: string, estimateMinutes: number | null = 120): WorkloadTask => ({
  id,
  title: id,
  projectId: null,
  projectTitle: null,
  priority: 'medium',
  estimateMinutes,
  planned: true,
  completed: false,
  boxes: [],
});
const source = (tasks: WorkloadTask[] = [work('a')]): WorkloadSource => ({
  date: '2026-10-14',
  timezone: 'UTC',
  availableHours: 8,
  asOf: start + 12 * hour,
  tasks,
  intervals: [],
});

describe('daily workload calculations', () => {
  it('uses one full-day denominator, without elapsed-day extrapolation', () => {
    const input = source();
    input.intervals = [{ taskId: 'a', start: start + hour, end: start + 3 * hour }];
    const result = calculateWorkload(input);
    expect(result.totals).toMatchObject({
      plannedMinutes: 120,
      trackedMinutes: 120,
      expectedPercent: 25,
      trackedPercent: 25,
      budgetLeftMinutes: 360,
      remainingMinutes: 0,
    });
  });
  it('counts overlapping and duplicate running intervals once and attributes slices evenly', () => {
    const input = source([work('a'), work('b')]);
    input.intervals = [
      { taskId: 'a', start: start + 9 * hour, end: null },
      { taskId: 'a', start: start + 9 * hour, end: null },
      { taskId: 'b', start: start + 10 * hour, end: start + 13 * hour },
    ];
    const result = calculateWorkload(input);
    expect(result.totals.trackedMinutes).toBe(180);
    expect(result.tasks.map((t) => t.trackedMinutes)).toEqual([120, 60]);
    expect(result.totals.overlapMinutes).toBe(300);
  });
  it('keeps missing estimates unknown and flags completed but untracked work', () => {
    const input = source([work('a', null), { ...work('b', null), completed: true }]);
    expect(calculateWorkload(input).totals).toMatchObject({
      missingEstimates: 2,
      untrackedCompleted: 1,
      plannedMinutes: 0,
      forecastHeadroomMinutes: 480,
    });
    expect(calculateWorkload(input).tasks[0]?.plannedMinutes).toBeNull();
  });
  it('uses each task once and does not add estimates to their timeboxes', () => {
    const input = source([
      {
        ...work('a', 90),
        boxes: [
          { start: start + 11 * hour, end: start + 13 * hour },
          { start: start + 12 * hour, end: start + 14 * hour },
        ],
      },
    ]);
    expect(calculateWorkload(input).totals).toMatchObject({
      plannedMinutes: 180,
      scheduledMinutes: 180,
      remainingScheduledMinutes: 120,
    });
  });
  it('reports a missing estimate even when a timebox supplies a known day-plan duration', () => {
    const input = source([
      { ...work('a', null), boxes: [{ start: start + hour, end: start + 2 * hour }] },
    ]);
    expect(calculateWorkload(input).totals).toMatchObject({
      plannedMinutes: 60,
      missingEstimates: 1,
      unknownDurations: 0,
    });
  });
  it('does not let task filters change the denominator and includes unscheduled actuals', () => {
    const input = source([{ ...work('a', null), planned: false }]);
    input.intervals = [{ taskId: 'a', start: start + hour, end: start + 2 * hour }];
    expect(calculateWorkload(input).tasks[0]).toMatchObject({
      plannedMinutes: 0,
      trackedMinutes: 60,
    });
  });
  it('shows over-allocation without clamping utilization or inflating capacity', () => {
    const input = source([work('a', 600)]);
    expect(calculateWorkload(input).totals).toMatchObject({
      expectedPercent: 125,
      plannedHeadroomMinutes: -120,
      forecastHeadroomMinutes: -120,
    });
    expect(calculateWorkload({ ...input, availableHours: 0 }).totals).toMatchObject({
      expectedPercent: null,
      trackedPercent: null,
    });
  });
  it.each([
    ['2026-03-08', 23],
    ['2026-11-01', 25],
  ])('clips actuals to a DST day %s (%ih)', (date, hours) => {
    const input = {
      ...source(),
      date,
      timezone: 'America/New_York',
      asOf: Date.parse(date) + 48 * hour,
    };
    input.intervals = [{ taskId: 'a', start: Date.parse(date) - 24 * hour, end: null }];
    expect(calculateWorkload(input).totals.trackedMinutes).toBe(hours * 60);
  });
  it('has no actuals or elapsed schedule on a future day', () => {
    const input = { ...source(), asOf: start - hour };
    input.intervals = [{ taskId: 'a', start: start + hour, end: null }];
    expect(calculateWorkload(input).totals.trackedMinutes).toBe(0);
  });
  it('ignores reversed intervals and excludes intervals outside the visible task scope', () => {
    const input = source();
    input.intervals = [
      { taskId: 'hidden', start, end: start + hour },
      { taskId: 'a', start: start + hour, end: start },
    ];
    expect(calculateWorkload(input).totals.trackedMinutes).toBe(0);
  });
});
