'use client';

/**
 * The typed data layer for the weekly plan and the daily loop.
 *
 * @remarks
 * Every read and write on these surfaces goes through this module — `apiQueryOptions` definitions
 * plus `useApiQuery`/`useApiMutation`, per `docs/engineering/specs/data-layer.md`. Nothing here
 * hand-rolls `useEffect` + `fetch`, and no component calls `api.v1.*` directly.
 *
 * The mutations all invalidate the coarse `['me','plan']` prefix rather than enumerating keys:
 * the week, the day's directive, its check-ins and its review are four views of the same day, and
 * a partial invalidation is exactly how one of them ends up disagreeing with the others.
 */
import { apiQueryOptions, queryKeys, STALE, useApiMutation, useApiQuery } from '@/lib/query';
import { api } from '@/lib/api';
import type {
  CheckInResponse,
  DayCheckInOut,
  DayReviewOut,
  DayStartOut,
  DirectiveOut,
  ReconcileDisposition,
  ReviewPromptKey,
  SchedulingPreferencesOut,
  WeekPlanOut,
  WorkShapeProfile,
} from '@docket/types';
import type { UseQueryResult } from '@tanstack/react-query';

/** The coarse key every plan surface hangs under; one invalidation refreshes them all. */
const PLAN_PREFIX = ['me', 'plan'] as const;

/** Read a generated week (or the current one when `weekStartDate` is omitted). */
export function useWeekPlan(weekStartDate: string): UseQueryResult<WeekPlanOut> {
  return useApiQuery(
    apiQueryOptions<WeekPlanOut>(
      queryKeys.scheduleWeek(weekStartDate),
      () => api.v1['schedule-week'].$get({ query: { weekStartDate } }),
      'Could not load your week.',
      { staleTime: STALE.volatile },
    ),
  );
}

/** Read the scheduling configuration — availability windows and standing commitments. */
export function useSchedulingPreferences(): UseQueryResult<SchedulingPreferencesOut> {
  return useApiQuery(
    apiQueryOptions<SchedulingPreferencesOut>(
      queryKeys.schedulePreferences(),
      () => api.v1['schedule-week'].preferences.$get(),
      'Could not load your scheduling setup.',
      { staleTime: STALE.static },
    ),
  );
}

/** Read the work-shape taxonomy so the UI never restates a constraint. */
export function useWorkShapes(): UseQueryResult<{ shapes: WorkShapeProfile[] }> {
  return useApiQuery(
    apiQueryOptions<{ shapes: WorkShapeProfile[] }>(
      queryKeys.workShapes(),
      () => api.v1['schedule-week'].shapes.$get(),
      'Could not load the kinds of time Docket plans.',
      { staleTime: STALE.static },
    ),
  );
}

/** Generate a week. One call, no per-item prompts. */
export function useGenerateWeek(weekStartDate: string) {
  return useApiMutation<WeekPlanOut, Record<string, never>>({
    mutationFn: async () => {
      const res = await api.v1['schedule-week'].$post({ json: { weekStartDate } });
      if (!res.ok) throw new Error('generate failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Read the start-of-day handshake. */
export function useDayStart(date: string): UseQueryResult<DayStartOut> {
  return useApiQuery(
    apiQueryOptions<DayStartOut>(
      queryKeys.dayStart(date),
      () => api.v1.directive['day-start'].$get({ query: { date } }),
      "Could not load today's agenda.",
      { staleTime: STALE.volatile },
    ),
  );
}

/** Read the daily directive — posture, reason, and the gates the day is waiting on. */
export function useDirective(date: string): UseQueryResult<DirectiveOut> {
  return useApiQuery(
    apiQueryOptions<DirectiveOut>(
      queryKeys.dayDirective(date),
      () => api.v1.directive.$get({ query: { date } }),
      'Could not read how today is going.',
      { staleTime: STALE.volatile },
    ),
  );
}

/** Read the day's check-ins. */
export function useDayCheckIns(date: string): UseQueryResult<{ items: DayCheckInOut[] }> {
  return useApiQuery(
    apiQueryOptions<{ items: DayCheckInOut[] }>(
      queryKeys.dayCheckIns(date),
      () => api.v1.directive['check-ins'].$get({ query: { date } }),
      "Could not load today's check-ins.",
      { staleTime: STALE.volatile },
    ),
  );
}

/** Read the end-of-day review. */
export function useDayReview(date: string): UseQueryResult<DayReviewOut> {
  return useApiQuery(
    apiQueryOptions<DayReviewOut>(
      queryKeys.dayReview(date),
      () => api.v1.directive.review.$get({ query: { date } }),
      'Could not load your day review.',
      { staleTime: STALE.volatile },
    ),
  );
}

/** Complete the morning agenda review — the release signal, which fires exactly once. */
export function useAcknowledgeAgenda(date: string) {
  return useApiMutation<{ fired: boolean; acknowledgedAt: string | null }, Record<string, never>>({
    mutationFn: async () => {
      const res = await api.v1.directive['day-start'].acknowledge.$post({ query: { date } });
      if (!res.ok) throw new Error('acknowledge failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Answer one check-in. */
export function useRespondToCheckIn() {
  return useApiMutation<
    { items: DayCheckInOut[] },
    { id: string; response: CheckInResponse; note?: string }
  >({
    mutationFn: async (variables) => {
      const res = await api.v1.directive['check-ins'][':id'].respond.$post({
        param: { id: variables.id },
        json: { response: variables.response, note: variables.note ?? null },
      });
      if (!res.ok) throw new Error('respond failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Re-cut the rest of the day around what actually happened. */
export function useReorganizeDay(date: string) {
  return useApiMutation<unknown, Record<string, never>>({
    mutationFn: async () => {
      const res = await api.v1.directive.reorganize.$post({ query: { date } });
      if (!res.ok) throw new Error('reorganize failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Decide what happens to one unfinished item. */
export function useDisposeReviewItem(date: string) {
  return useApiMutation<
    DayReviewOut,
    {
      key: string;
      disposition: ReconcileDisposition;
      rescheduledTo?: string | null;
      reason?: string | null;
    }
  >({
    mutationFn: async (variables) => {
      const res = await api.v1.directive.review.disposition.$post({
        query: { date },
        json: {
          key: variables.key,
          disposition: variables.disposition,
          rescheduledTo: variables.rescheduledTo ?? null,
          reason: variables.reason ?? null,
        },
      });
      if (!res.ok) throw new Error('disposition failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Answer one of the three fixed reflection questions. */
export function useAnswerReviewPrompt(date: string) {
  return useApiMutation<DayReviewOut, { key: ReviewPromptKey; answer: string }>({
    mutationFn: async (variables) => {
      const res = await api.v1.directive.review.answer.$post({
        query: { date },
        json: { key: variables.key, answer: variables.answer },
      });
      if (!res.ok) throw new Error('answer failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}

/** Confirm tomorrow's agenda — the last step, and never implicit. */
export function useConfirmTomorrow(date: string) {
  return useApiMutation<DayReviewOut, { acceptedKeys: string[] }>({
    mutationFn: async (variables) => {
      const res = await api.v1.directive.review['confirm-tomorrow'].$post({
        query: { date },
        json: { acceptedKeys: variables.acceptedKeys },
      });
      if (!res.ok) throw new Error('confirm failed');
      return await res.json();
    },
    invalidateKeys: [PLAN_PREFIX],
  });
}
