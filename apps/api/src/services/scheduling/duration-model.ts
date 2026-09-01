/**
 * `@docket/api` — how long a session actually takes, learned from the Time Ledger.
 *
 * @remarks
 * A planner that guesses durations produces a week that is wrong by lunchtime on Monday. Docket
 * already records the truth: the universal timer writes `time_record` rows anchored to a task,
 * with exact `time_interval` segments underneath. This module turns those into the one number
 * the planner needs — "how long does a session of this actually run" — and is explicit in the
 * output about where that number came from, so a person is never shown a confident estimate
 * built on nothing.
 *
 * **Median, not mean.** One four-hour session that was really "forgot to stop the timer" would
 * drag a mean permanently upward. The median is unbothered by it, and the sample thresholds
 * below (two observations for a specific task, three for a whole shape) mean a single unusual
 * day never becomes the plan.
 */
import type { WorkShape } from '@docket/planning/scheduling-contract';
import { workShapeProfile } from '@docket/planning/scheduling-contract';

/** Observed session lengths for one subject. */
export interface DurationSamples {
  /** Every completed session's length in minutes, in any order. */
  readonly minutes: readonly number[];
}

/** Everything measured about how this person actually spends time. */
export interface ActualsIndex {
  /** Session lengths keyed by the task the timer was anchored to. */
  readonly byTaskId: ReadonlyMap<string, DurationSamples>;
  /** Session lengths keyed by the work shape the tracked time was blocked as. */
  readonly byShape: ReadonlyMap<WorkShape, DurationSamples>;
}

/** An empty index — the honest state before anyone has tracked anything. */
export const EMPTY_ACTUALS: ActualsIndex = { byTaskId: new Map(), byShape: new Map() };

/** Minimum observations before a single task's own history is trusted over a request. */
const TASK_SAMPLE_FLOOR = 2;
/** Minimum observations before a whole shape's history is trusted over a request. */
const SHAPE_SAMPLE_FLOOR = 3;

/**
 * The median of a sample set, rounded to the nearest minute.
 *
 * @param minutes - Observed lengths.
 * @returns the median, or null when there is nothing to average.
 */
export function medianMinutes(minutes: readonly number[]): number | null {
  const sorted = [...minutes].filter((m) => m > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[mid] ?? 0);
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

/** Where a planned duration came from — reported on every block. */
export type DurationSource = 'measured' | 'requested' | 'shape_default' | 'fitted';

/** A resolved session length and its provenance. */
export interface EstimatedDuration {
  readonly minutes: number;
  readonly source: DurationSource;
}

/**
 * Decide how long one session of a commitment should be.
 *
 * @remarks
 * Resolution order, most to least specific: this exact task's own measured history, then the
 * shape's measured history across every task, then what the person asked for, then the shape's
 * documented default. The result is always clamped into the shape's `[minMinutes, maxMinutes]`,
 * so a runaway timer cannot produce a six-hour writing block.
 *
 * @param input.shape - The work shape being planned.
 * @param input.taskId - The task the commitment tracks, when it has one.
 * @param input.requestedMinutes - What the commitment asked for, when it said.
 * @param input.actuals - The measured index.
 * @returns the session length and where it came from.
 */
export function estimateSessionMinutes(input: {
  readonly shape: WorkShape;
  readonly taskId: string | null;
  readonly requestedMinutes: number | null;
  readonly actuals: ActualsIndex;
}): EstimatedDuration {
  const profile = workShapeProfile(input.shape);
  const clamp = (m: number): number =>
    Math.max(profile.minMinutes, Math.min(profile.maxMinutes, Math.round(m)));

  if (input.taskId !== null) {
    const samples = input.actuals.byTaskId.get(input.taskId);
    const measured =
      samples && samples.minutes.length >= TASK_SAMPLE_FLOOR
        ? medianMinutes(samples.minutes)
        : null;
    if (measured !== null) return { minutes: clamp(measured), source: 'measured' };
  }

  const shapeSamples = input.actuals.byShape.get(input.shape);
  const shapeMeasured =
    shapeSamples && shapeSamples.minutes.length >= SHAPE_SAMPLE_FLOOR
      ? medianMinutes(shapeSamples.minutes)
      : null;
  if (shapeMeasured !== null) return { minutes: clamp(shapeMeasured), source: 'measured' };

  if (input.requestedMinutes !== null) {
    return { minutes: clamp(input.requestedMinutes), source: 'requested' };
  }
  return { minutes: clamp(profile.defaultMinutes), source: 'shape_default' };
}
