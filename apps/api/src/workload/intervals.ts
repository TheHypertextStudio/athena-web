/** A half-open interval in server epoch milliseconds. */
export interface WorkloadInterval {
  readonly start: number;
  readonly end: number | null;
}

/** Clip a valid interval to a half-open window, discarding empty or reversed spans. */
export function clipInterval(
  interval: WorkloadInterval,
  start: number,
  end: number,
): [number, number] | null {
  const a = Math.max(start, interval.start);
  const b = Math.min(end, interval.end ?? end);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
}

/** Union duration in minutes; overlaps and duplicate intervals count once. */
export function unionMinutes(
  intervals: readonly WorkloadInterval[],
  start: number,
  end: number,
): number {
  const spans = intervals
    .map((i) => clipInterval(i, start, end))
    .filter((i): i is [number, number] => i !== null)
    .sort((a, b) => a[0] - b[0]);
  let lastEnd = start;
  let total = 0;
  for (const [a, b] of spans) {
    total += Math.max(0, b - Math.max(lastEnd, a));
    lastEnd = Math.max(lastEnd, b);
  }
  return total / 60_000;
}

/** An interval attributed to a readable task. */
export interface TaskInterval extends WorkloadInterval {
  readonly taskId: string;
}

/**
 * Attribute union slices equally among distinct active tasks. Duplicate same-task timers do not
 * gain extra weight. Each endpoint is visited once after sorting, so chart totals conserve time.
 */
export function attributeMinutes(
  intervals: readonly TaskInterval[],
  start: number,
  end: number,
): Map<string, number> {
  const events: { at: number; taskId: string; delta: number }[] = [];
  for (const interval of intervals) {
    const span = clipInterval(interval, start, end);
    if (!span) continue;
    events.push(
      { at: span[0], taskId: interval.taskId, delta: 1 },
      { at: span[1], taskId: interval.taskId, delta: -1 },
    );
  }
  events.sort((a, b) => a.at - b.at);
  const active = new Map<string, number>();
  const minutes = new Map<string, number>();
  let previous = start;
  for (const event of events) {
    const share = (event.at - previous) / 60_000 / active.size;
    for (const id of active.keys()) minutes.set(id, (minutes.get(id) ?? 0) + share);
    const count = (active.get(event.taskId) ?? 0) + event.delta;
    if (count === 0) active.delete(event.taskId);
    else active.set(event.taskId, count);
    previous = event.at;
  }
  return minutes;
}
