/** A time interval projected from the caller's personal ledger. */
interface ProgressInterval {
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly mode: string;
  readonly source: string;
  readonly userId: string | null;
  readonly supersededById: string | null;
}

/** Inputs that bound and qualify intervals for one time goal. */
interface ProgressWindow {
  readonly start: number;
  readonly end: number;
  readonly now: number;
  readonly userId: string;
  readonly includeManual: boolean;
}

/** Count distinct wall-clock milliseconds of the person's qualifying tracked time. */
export function measureHumanProgress(
  intervals: readonly ProgressInterval[],
  window: ProgressWindow,
): number {
  const spans = intervals
    .flatMap((interval) => {
      if (
        interval.userId !== window.userId ||
        interval.mode !== 'human_active' ||
        interval.supersededById !== null ||
        (interval.source !== 'user_timer' &&
          !(
            window.includeManual &&
            (interval.source === 'manual_entry' || interval.source === 'reconstructed_entry')
          ))
      )
        return [];
      const start = Math.max(window.start, Date.parse(interval.startedAt));
      const end = Math.min(
        window.end,
        window.now,
        interval.endedAt === null ? window.now : Date.parse(interval.endedAt),
      );
      return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
    })
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let currentStart: number | undefined;
  let currentEnd = 0;
  for (const span of spans) {
    if (currentStart === undefined) {
      currentStart = span.start;
      currentEnd = span.end;
    } else if (span.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, span.end);
    } else {
      total += currentEnd - currentStart;
      currentStart = span.start;
      currentEnd = span.end;
    }
  }
  return currentStart === undefined ? 0 : total + currentEnd - currentStart;
}
