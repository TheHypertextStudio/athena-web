/** Work windows and commitments for one read-only daily proposal. */
import { calendarItem, db, schedulingPreference } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  mergeIntervals,
  subtractIntervals,
  type Interval,
  type Span,
} from '@docket/planning/intervals';
import type { WorkScheduleOut } from '@docket/planning/work-location-contract';
import { expandWorkSchedulePlan } from '@docket/planning/work-schedule';
import { addDays, instantAt, weekdayOf } from '@docket/planning/zoned-time';
import { and, eq, inArray, isNull, lt, ne, or, gt, lte } from 'drizzle-orm';
import { readStoredWorkSchedule } from './work-location/schedule-storage';

/** Visible fixed calendar context shared by planning and review. */
export interface ProposalFixedInterval {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: 'event' | 'protected';
}

/** Exact availability with a visible editable fallback when no schedule governs the date. */
export interface ProposalAvailability {
  readonly windows: readonly Span[];
  readonly busy: readonly Interval[];
  readonly workScheduleMissing: boolean;
  readonly startAt: string;
  readonly finishAt: string;
  readonly fixedIntervals: readonly ProposalFixedInterval[];
}

interface AvailabilityInput {
  readonly userId: string;
  readonly hubId: string;
  readonly date: string;
  readonly timezone: string;
  readonly draft: DailyPlanSnapshot | null;
  readonly now: Date;
}

type WeeklyWindow = (typeof schedulingPreference.$inferSelect)['windows'][number];

function weeklyInterval(window: WeeklyWindow, input: AvailabilityInput): Interval {
  return {
    start: instantAt(input.date, window.startMinute, input.timezone).getTime(),
    end: instantAt(input.date, window.endMinute, input.timezone).getTime(),
  };
}

function canonicalWindows(
  schedule: WorkScheduleOut,
  input: AvailabilityInput,
  dayStart: Date,
  dayEnd: Date,
): { hasCanonicalDay: boolean; segments: Interval[] } {
  const canonical = schedule.plans.flatMap((plan) =>
    expandWorkSchedulePlan({
      plan,
      exceptions: schedule.exceptions,
      startDate: addDays(input.date, -1),
      endDate: input.date,
    }),
  );
  const segments = canonical
    .flatMap((day) => day.segments)
    .map((segment) => ({
      start: Math.max(dayStart.getTime(), Date.parse(segment.startsAt)),
      end: Math.min(dayEnd.getTime(), Date.parse(segment.endsAt)),
    }))
    .filter((span) => span.end > span.start);
  return { hasCanonicalDay: canonical.some((day) => day.date === input.date), segments };
}

function planningBounds(
  input: AvailabilityInput,
  known: readonly Interval[],
  dayStart: Date,
  dayEnd: Date,
): { startAt: string; finishAt: string; fallback: Interval } {
  const defaultStart = instantAt(input.date, 9 * 60, input.timezone).getTime();
  const currentStart =
    input.now.getTime() < dayEnd.getTime() ? input.now.getTime() : dayStart.getTime();
  const start = input.draft?.settings?.startAt
    ? Date.parse(input.draft.settings.startAt)
    : Math.max(currentStart, known[0]?.start ?? defaultStart);
  const defaultFinish =
    known.length > 0
      ? Math.max(...known.map((span) => span.end))
      : instantAt(input.date, 17 * 60, input.timezone).getTime();
  const finish = input.draft?.finishAt ? Date.parse(input.draft.finishAt) : defaultFinish;
  return {
    startAt: new Date(start).toISOString(),
    finishAt: new Date(finish).toISOString(),
    fallback: { start, end: finish },
  };
}

function protectedContext(
  weekly: readonly WeeklyWindow[],
  input: AvailabilityInput,
): ProposalFixedInterval[] {
  return weekly
    .filter((window) => window.kind === 'personal')
    .map((window, index) => {
      const interval = weeklyInterval(window, input);
      return {
        id: `protected:${input.date}:${String(index)}`,
        title: window.label ?? 'Protected time',
        startsAt: new Date(interval.start).toISOString(),
        endsAt: new Date(interval.end).toISOString(),
        kind: 'protected',
      };
    });
}

function deduplicateWindows(
  intervals: readonly Interval[],
  protectedTime: readonly Interval[],
  date: string,
): Span[] {
  const windows: Span[] = [];
  // Keep location segment boundaries while removing duplicate minutes from overlapping windows.
  for (const interval of intervals)
    windows.push(
      ...subtractIntervals([{ ...interval, date, kind: 'desk' }], [...protectedTime, ...windows]),
    );
  return windows;
}

async function nativeCommitments(
  input: AvailabilityInput,
  dayStart: Date,
  dayEnd: Date,
): Promise<ProposalFixedInterval[]> {
  const native = await db
    .select()
    .from(calendarItem)
    .where(
      and(
        eq(calendarItem.userId, input.userId),
        isNull(calendarItem.archivedAt),
        inArray(calendarItem.kind, ['native_event', 'native_block', 'timebox', 'task_timebox']),
        ne(calendarItem.status, 'cancelled'),
        or(
          and(lt(calendarItem.startsAt, dayEnd), gt(calendarItem.endsAt, dayStart)),
          and(
            lte(calendarItem.allDayStartDate, input.date),
            gt(calendarItem.allDayEndDate, input.date),
          ),
        ),
      ),
    );
  return native.map((item) => ({
    id: item.id,
    title: item.title,
    startsAt: (item.startsAt ?? dayStart).toISOString(),
    endsAt: (item.endsAt ?? dayEnd).toISOString(),
    kind: 'event',
  }));
}

/** Load canonical segments, protected windows, and native calendar commitments. */
export async function loadProposalAvailability(
  input: AvailabilityInput,
): Promise<ProposalAvailability> {
  const dayStart = instantAt(input.date, 0, input.timezone);
  const dayEnd = instantAt(addDays(input.date, 1), 0, input.timezone);
  const [schedule, preferences, native] = await Promise.all([
    readStoredWorkSchedule(db, input.hubId),
    db
      .select()
      .from(schedulingPreference)
      .where(eq(schedulingPreference.hubId, input.hubId))
      .limit(1),
    nativeCommitments(input, dayStart, dayEnd),
  ]);
  const { hasCanonicalDay, segments } = canonicalWindows(schedule, input, dayStart, dayEnd);
  const weekly = (preferences[0]?.windows ?? []).filter(
    (window) => window.weekday === weekdayOf(input.date),
  );
  const scheduled = weekly
    .filter((window) => window.kind === 'desk' || window.kind === 'field')
    .map((window) => weeklyInterval(window, input));
  const workScheduleMissing = !hasCanonicalDay && scheduled.length === 0;
  const known = hasCanonicalDay ? segments : scheduled;
  const bounds = planningBounds(input, known, dayStart, dayEnd);
  const protectedIntervals = protectedContext(weekly, input);
  const protectedTime = protectedIntervals.map((interval) => ({
    start: Date.parse(interval.startsAt),
    end: Date.parse(interval.endsAt),
  }));
  const windows = deduplicateWindows(
    workScheduleMissing ? [bounds.fallback] : known,
    protectedTime,
    input.date,
  );
  const busy = mergeIntervals(
    native.map((item) => ({ start: Date.parse(item.startsAt), end: Date.parse(item.endsAt) })),
  );
  return {
    windows,
    busy,
    fixedIntervals: [...native, ...protectedIntervals],
    workScheduleMissing,
    startAt: bounds.startAt,
    finishAt: bounds.finishAt,
  };
}
