import { addDays, instantAt } from '@docket/planning/zoned-time';
import {
  attributeMinutes,
  unionMinutes,
  type TaskInterval,
  type WorkloadInterval,
} from './intervals';

/** One visible task, deduplicated by the repository before calculation. */
export interface WorkloadTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly projectTitle: string | null;
  readonly priority: string;
  readonly estimateMinutes: number | null;
  readonly planned: boolean;
  readonly completed: boolean;
  readonly boxes: readonly WorkloadInterval[];
}

/** Permission-filtered input. The server clock is injected for reproducible snapshot calculations. */
export interface WorkloadSource {
  readonly date: string;
  readonly timezone: string;
  readonly availableHours: number;
  readonly asOf: number;
  readonly tasks: readonly WorkloadTask[];
  intervals: readonly TaskInterval[];
}

/** Per-task facts; null planned duration means unknown rather than zero. */
export interface WorkloadTaskResult extends WorkloadTask {
  readonly plannedMinutes: number | null;
  readonly trackedMinutes: number;
  readonly remainingMinutes: number | null;
}

function taskResult(
  t: WorkloadTask,
  actual: ReadonlyMap<string, number>,
  start: number,
  end: number,
): WorkloadTaskResult {
  const boxed = unionMinutes(t.boxes, start, end);
  const known = t.estimateMinutes !== null || boxed > 0;
  const plannedMinutes = t.planned ? (known ? Math.max(t.estimateMinutes ?? 0, boxed) : null) : 0;
  const trackedMinutes = actual.get(t.id) ?? 0;
  return {
    ...t,
    plannedMinutes,
    trackedMinutes,
    remainingMinutes: t.completed
      ? 0
      : plannedMinutes === null
        ? null
        : Math.max(0, plannedMinutes - trackedMinutes),
  };
}

/**
 * Calculate a daily snapshot. Both ratios divide by the configured full-day budget. See the
 * calculation contract in docs/engineering/specs/daily-workload.md for scope and unknown semantics.
 */
export function calculateWorkload(input: WorkloadSource): WorkloadSnapshot {
  const start = instantAt(input.date, 0, input.timezone).getTime();
  const end = instantAt(addDays(input.date, 1), 0, input.timezone).getTime();
  const cutoff = Math.max(start, Math.min(end, input.asOf));
  const ids = new Set(input.tasks.map((t) => t.id));
  const intervals = input.intervals.filter((i) => ids.has(i.taskId));
  const actual = attributeMinutes(intervals, start, cutoff);
  const tasks = input.tasks.map((t) => taskResult(t, actual, start, end));
  const boxes = tasks.filter((t) => t.planned).flatMap((t) => t.boxes);
  const trackedMinutes = unionMinutes(intervals, start, cutoff);
  const plannedMinutes = tasks.reduce((n, t) => n + (t.plannedMinutes ?? 0), 0);
  const remainingMinutes = tasks.reduce((n, t) => n + (t.remainingMinutes ?? 0), 0);
  const availableMinutes = input.availableHours * 60;
  const grossMinutes = intervals.reduce((n, i) => n + unionMinutes([i], start, cutoff), 0);
  return {
    date: input.date,
    timezone: input.timezone,
    availableHours: input.availableHours,
    asOf: new Date(input.asOf).toISOString(),
    dayStartsAt: new Date(start).toISOString(),
    dayEndsAt: new Date(end).toISOString(),
    tasks,
    totals: {
      availableMinutes,
      plannedMinutes,
      trackedMinutes,
      remainingMinutes,
      expectedPercent: availableMinutes > 0 ? (plannedMinutes / availableMinutes) * 100 : null,
      trackedPercent: availableMinutes > 0 ? (trackedMinutes / availableMinutes) * 100 : null,
      plannedHeadroomMinutes: availableMinutes - plannedMinutes,
      budgetLeftMinutes: availableMinutes - trackedMinutes,
      forecastHeadroomMinutes: availableMinutes - trackedMinutes - remainingMinutes,
      scheduledMinutes: unionMinutes(boxes, start, end),
      remainingScheduledMinutes: unionMinutes(boxes, cutoff, end),
      scheduleOverlapMinutes:
        boxes.reduce((n, i) => n + unionMinutes([i], start, end), 0) -
        unionMinutes(boxes, start, end),
      overlapMinutes: Math.max(0, grossMinutes - trackedMinutes),
      missingEstimates: tasks.filter((t) => t.planned && t.estimateMinutes === null).length,
      unknownDurations: tasks.filter((t) => t.plannedMinutes === null).length,
      untrackedCompleted: tasks.filter((t) => t.completed && t.trackedMinutes === 0).length,
      plannedTasks: tasks.filter((t) => t.planned).length,
    },
  };
}

/** The serializable, reproducible calculation snapshot. */
export interface WorkloadSnapshot {
  readonly date: string;
  readonly timezone: string;
  readonly availableHours: number;
  readonly asOf: string;
  readonly dayStartsAt: string;
  readonly dayEndsAt: string;
  readonly tasks: readonly WorkloadTaskResult[];
  readonly totals: {
    readonly availableMinutes: number;
    readonly plannedMinutes: number;
    readonly trackedMinutes: number;
    readonly remainingMinutes: number;
    readonly expectedPercent: number | null;
    readonly trackedPercent: number | null;
    readonly plannedHeadroomMinutes: number;
    readonly budgetLeftMinutes: number;
    readonly forecastHeadroomMinutes: number;
    readonly scheduledMinutes: number;
    readonly remainingScheduledMinutes: number;
    readonly scheduleOverlapMinutes: number;
    readonly overlapMinutes: number;
    readonly missingEstimates: number;
    readonly unknownDurations: number;
    readonly untrackedCompleted: number;
    readonly plannedTasks: number;
  };
}

/** A personal workload snapshot within one authorized workspace. */
export interface WorkloadView extends WorkloadSnapshot {
  readonly orgId: string;
  readonly workspaceName: string;
}
