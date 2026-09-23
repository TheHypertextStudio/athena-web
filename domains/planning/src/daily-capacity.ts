/** Pure calculations shared by daily planning and its review screens. */

/** One half-open interval in minutes from the start of the planning date. */
export interface PlanningInterval {
  readonly startsAt: number;
  readonly endsAt: number;
}

/** Inputs for remaining workday capacity. */
export interface DailyCapacityInput {
  readonly window: PlanningInterval;
  readonly now: number;
  readonly fixed: readonly PlanningInterval[];
  readonly plannedMinutes: number;
}

/** Available minutes after now, after removing the union of fixed commitments. */
export function calculateDailyCapacity(input: DailyCapacityInput): {
  readonly availableMinutes: number;
  readonly plannedMinutes: number;
  readonly differenceMinutes: number;
} {
  const first = Math.max(input.now, input.window.startsAt);
  const end = input.window.endsAt;
  if (first >= end) {
    return {
      availableMinutes: 0,
      plannedMinutes: input.plannedMinutes,
      differenceMinutes: -input.plannedMinutes,
    };
  }

  const fixed = input.fixed
    .map(({ startsAt, endsAt }) => ({
      startsAt: Math.max(first, startsAt),
      endsAt: Math.min(end, endsAt),
    }))
    .filter((interval) => interval.startsAt < interval.endsAt)
    .sort((left, right) => left.startsAt - right.startsAt);

  let occupied = 0;
  let coveredUntil = first;
  for (const interval of fixed) {
    occupied += Math.max(0, interval.endsAt - Math.max(coveredUntil, interval.startsAt));
    coveredUntil = Math.max(coveredUntil, interval.endsAt);
  }
  const availableMinutes = end - first - occupied;
  return {
    availableMinutes,
    plannedMinutes: input.plannedMinutes,
    differenceMinutes: availableMinutes - input.plannedMinutes,
  };
}

/** Planned time, session time, and completion remain independent facts. */
export function taskProgress(input: {
  readonly plannedMinutes: number;
  readonly scheduledMinutes: readonly number[];
  readonly actualMinutes: readonly number[];
  readonly completed: boolean;
}): {
  readonly plannedMinutes: number;
  readonly scheduledMinutes: number;
  readonly unscheduledMinutes: number;
  readonly actualMinutes: number;
  readonly completed: boolean;
} {
  const scheduledMinutes = input.scheduledMinutes.reduce((total, value) => total + value, 0);
  return {
    plannedMinutes: input.plannedMinutes,
    scheduledMinutes,
    unscheduledMinutes: Math.max(0, input.plannedMinutes - scheduledMinutes),
    actualMinutes: input.actualMinutes.reduce((total, value) => total + value, 0),
    completed: input.completed,
  };
}
