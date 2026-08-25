/** URL-backed state and calendar arithmetic for the personal Time review. */
import { Temporal } from '@js-temporal/polyfill';

/** The peer ways a person can inspect their own selected records. */
export type TimeReviewView = 'sessions' | 'breakdown' | 'now';
/** The calendar range kinds a person can navigate. */
export type TimeReviewPeriod = 'day' | 'week' | 'month' | 'cycle' | 'custom';
/** Which additive effort measure the page presents. */
export type TimeReviewMeasure = 'human' | 'agent' | 'combined';

/** One cycle available to the caller's personal history picker. */
export interface TimeReviewCycle {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** The settled selection behind all time-review queries and controls. */
export interface TimeReviewState {
  readonly view: TimeReviewView;
  readonly period: TimeReviewPeriod;
  readonly anchor: string;
  readonly cycleId?: string | undefined;
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly measure: TimeReviewMeasure;
  readonly workspaceId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly categoryId?: string | undefined;
  readonly captureSource?: 'live' | 'manual' | 'reconstructed' | 'agent' | undefined;
}

/** The exact half-open UTC window sent to the Time Ledger. */
export interface TimeReviewRange {
  readonly start: string;
  readonly end: string;
  readonly label: string;
}

/** Filters with omitted keys so typed API clients never receive explicit `undefined` values. */
export interface TimeReviewApiFilters {
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly taskId?: string;
  readonly categoryId?: string;
  readonly captureSource?: 'live' | 'manual' | 'reconstructed' | 'agent';
}

const VIEWS: readonly TimeReviewView[] = ['sessions', 'breakdown', 'now'];
const PERIODS: readonly TimeReviewPeriod[] = ['day', 'week', 'month', 'cycle', 'custom'];
const MEASURES: readonly TimeReviewMeasure[] = ['human', 'agent', 'combined'];
const SOURCES = ['live', 'manual', 'reconstructed', 'agent'] as const;

function inValues<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function plainDate(
  value: string | null | undefined,
  fallback: Temporal.PlainDate,
): Temporal.PlainDate {
  if (!value) return fallback;
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return fallback;
  }
}

function currentDate(timezone: string, now: string): Temporal.PlainDate {
  try {
    return Temporal.Instant.from(now).toZonedDateTimeISO(timezone).toPlainDate();
  } catch {
    try {
      return Temporal.PlainDate.from(now);
    } catch {
      return Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
    }
  }
}

function localMidnight(date: Temporal.PlainDate, timezone: string): string {
  return Temporal.ZonedDateTime.from({
    timeZone: timezone,
    year: date.year,
    month: date.month,
    day: date.day,
    hour: 0,
  })
    .toInstant()
    .toString();
}

function rangeLabel(start: Temporal.PlainDate, endExclusive: Temporal.PlainDate): string {
  const end = endExclusive.subtract({ days: 1 });
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const startText = `${months[start.month - 1] ?? ''} ${start.day}`;
  const endText =
    start.year === end.year && start.month === end.month
      ? `${end.day}, ${end.year}`
      : `${months[end.month - 1] ?? ''} ${end.day}, ${end.year}`;
  return start.equals(end) ? endText : `${startText} – ${endText}`;
}

/** Parse a safe review selection from a copied URL or browser location. */
export function parseTimeReviewState(
  params: URLSearchParams,
  timezone: string,
  now = new Date().toISOString(),
): TimeReviewState {
  const today = currentDate(timezone, now);
  const period = inValues(params.get('period'), PERIODS, 'week');
  const customStart = plainDate(params.get('start'), today);
  const customEnd = plainDate(params.get('end'), customStart.add({ days: 1 }));
  const validCustom = Temporal.PlainDate.compare(customEnd, customStart) > 0;
  const captureSource = params.get('captureSource');
  return {
    view: inValues(params.get('view'), VIEWS, 'sessions'),
    period: period === 'custom' && !validCustom ? 'week' : period,
    anchor: plainDate(params.get('anchor'), today).toString(),
    ...(params.get('cycleId') ? { cycleId: params.get('cycleId') ?? undefined } : {}),
    ...(period === 'custom' && validCustom
      ? { start: customStart.toString(), end: customEnd.toString() }
      : {}),
    measure: inValues(params.get('measure'), MEASURES, 'human'),
    ...(params.get('workspaceId') ? { workspaceId: params.get('workspaceId') ?? undefined } : {}),
    ...(params.get('projectId') ? { projectId: params.get('projectId') ?? undefined } : {}),
    ...(params.get('taskId') ? { taskId: params.get('taskId') ?? undefined } : {}),
    ...(params.get('categoryId') ? { categoryId: params.get('categoryId') ?? undefined } : {}),
    ...(SOURCES.includes(captureSource as (typeof SOURCES)[number])
      ? { captureSource: captureSource as TimeReviewState['captureSource'] }
      : {}),
  };
}

/** Resolve the selected calendar period to the exact half-open Time Ledger query window. */
export function resolveTimeReviewRange(
  state: TimeReviewState,
  timezone: string,
  cycles: readonly TimeReviewCycle[] = [],
): TimeReviewRange {
  const anchor = Temporal.PlainDate.from(state.anchor);
  if (state.period === 'custom' && state.start && state.end) {
    const start = Temporal.PlainDate.from(state.start);
    const end = Temporal.PlainDate.from(state.end);
    return {
      start: localMidnight(start, timezone),
      end: localMidnight(end, timezone),
      label: rangeLabel(start, end),
    };
  }
  if (state.period === 'cycle') {
    const cycle = cycles.find((entry) => entry.id === state.cycleId);
    if (cycle) {
      const start = Temporal.Instant.from(cycle.startsAt)
        .toZonedDateTimeISO(timezone)
        .toPlainDate();
      const end = Temporal.Instant.from(cycle.endsAt).toZonedDateTimeISO(timezone).toPlainDate();
      return {
        start: cycle.startsAt,
        end: cycle.endsAt,
        label: cycle.name || rangeLabel(start, end),
      };
    }
  }
  const start =
    state.period === 'day'
      ? anchor
      : state.period === 'month'
        ? anchor.with({ day: 1 })
        : anchor.subtract({ days: anchor.dayOfWeek - 1 });
  const end =
    state.period === 'day'
      ? start.add({ days: 1 })
      : state.period === 'month'
        ? start.add({ months: 1 })
        : start.add({ days: 7 });
  return {
    start: localMidnight(start, timezone),
    end: localMidnight(end, timezone),
    label: rangeLabel(start, end),
  };
}

/** Apply one settled UI change while preserving the filter hierarchy invariant. */
export function applyTimeReviewPatch(
  state: TimeReviewState,
  patch: Partial<TimeReviewState>,
): TimeReviewState {
  const next = { ...state, ...patch };
  if ('workspaceId' in patch && patch.workspaceId !== state.workspaceId) {
    next.projectId = undefined;
    next.taskId = undefined;
  }
  if ('projectId' in patch && patch.projectId !== state.projectId) next.taskId = undefined;
  if (next.period !== 'custom') {
    delete next.start;
    delete next.end;
  }
  return next;
}

/** Serialize settled state without URL keys that have no meaning for the selection. */
export function serializeTimeReviewState(state: TimeReviewState): URLSearchParams {
  const params = new URLSearchParams({
    view: state.view,
    period: state.period,
    anchor: state.anchor,
    measure: state.measure,
  });
  const entries: readonly (readonly [string, string | undefined])[] = [
    ['cycleId', state.cycleId],
    ['start', state.start],
    ['end', state.end],
    ['workspaceId', state.workspaceId],
    ['projectId', state.projectId],
    ['taskId', state.taskId],
    ['categoryId', state.categoryId],
    ['captureSource', state.captureSource],
  ];
  for (const [key, value] of entries) if (value) params.set(key, value);
  return params;
}

/** Move the selected calendar range one complete prior or next period. */
export function navigateTimeReviewPeriod(
  state: TimeReviewState,
  direction: -1 | 1,
): TimeReviewState {
  const anchor = Temporal.PlainDate.from(state.anchor);
  const amount =
    state.period === 'day'
      ? { days: direction }
      : state.period === 'month'
        ? { months: direction }
        : { days: direction * 7 };
  if (state.period === 'custom' && state.start && state.end) {
    const start = Temporal.PlainDate.from(state.start);
    const end = Temporal.PlainDate.from(state.end);
    const days = start.until(end, { largestUnit: 'days' }).days;
    return applyTimeReviewPatch(state, {
      anchor: anchor.add({ days: direction * days }).toString(),
      start: start.add({ days: direction * days }).toString(),
      end: end.add({ days: direction * days }).toString(),
    });
  }
  return applyTimeReviewPatch(state, { anchor: anchor.add(amount).toString() });
}

/** Build the typed API filters from the one settled review selection. */
export function timeReviewApiFilters(state: TimeReviewState): TimeReviewApiFilters {
  const { workspaceId, projectId, taskId, categoryId, captureSource } = state;
  return {
    ...(workspaceId ? { workspaceId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(captureSource ? { captureSource } : {}),
  };
}
