'use client';

/** Typed reads and writes for the focused daily planning flow. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { SearchOut } from '@/lib/contracts/search';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** Read one day, including its accepted history and actual work. */
export function useDailyPlanningDay(date: string) {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.dailyPlanningDay(date),
      () => api.v1['daily-plan'].day[':date'].$get({ param: { date } }),
      'Could not load this day.',
    ),
  );
}

/** Browse viewable tasks across workspaces. */
export function useAvailableDailyWork(query: string, enabled: boolean) {
  return useApiQuery(
    apiQueryOptions<SearchOut>(
      queryKeys.search('hub', `daily-plan:${query}`, null),
      () =>
        api.v1.hub.search.$get({
          query: {
            ...(query.trim() ? { q: query.trim() } : {}),
            kinds: 'task',
            limit: '60',
            surface: 'page',
          },
        }),
      'Could not load available tasks.',
      { enabled },
    ),
  );
}

/** Save the draft while leaving any accepted version unchanged. */
export function useSaveDailyDraft(date: string) {
  return useApiMutation({
    mutationFn: ({
      draft,
      resumeStep,
    }: {
      draft: DailyPlanSnapshot;
      resumeStep: 'review_yesterday' | 'plan_today' | 'review_plan';
    }) =>
      unwrap(
        () =>
          api.v1['daily-plan'].day[':date'].draft.$put({
            param: { date },
            json: { draft, resumeStep },
          }),
        'Could not save your plan.',
      ),
    invalidateKeys: [queryKeys.dailyPlanningDay(date)],
  });
}

/** Accept the saved draft without starting work. */
export function useConfirmDailyPlan(date: string) {
  return useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1['daily-plan'].day[':date'].confirm.$post({ param: { date } }),
        'Could not confirm your plan.',
      ),
    invalidateKeys: [
      queryKeys.dailyPlanningDay(date),
      queryKeys.dailyPlan(date),
      queryKeys.today(date),
      queryKeys.agenda(date),
    ],
  });
}

/** Rename one task and refresh every place that displays it. */
export function useRenameDailyTask(date: string) {
  return useApiMutation({
    mutationFn: ({
      organizationId,
      taskId,
      title,
    }: {
      organizationId: string;
      taskId: string;
      title: string;
    }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks[':id'].$patch({
            param: { orgId: organizationId, id: taskId },
            json: { title },
          }),
        'Could not rename the task.',
      ),
    invalidateKeys: [
      queryKeys.dailyPlanningDay(date),
      queryKeys.dailyPlan(date),
      queryKeys.today(date),
      queryKeys.agenda(date),
    ],
  });
}

/** Complete a prior accepted item through the same task transition as Today. */
export function useCompleteReviewItem(previousDate: string, date: string) {
  return useApiMutation({
    mutationFn: (planItemId: string) =>
      unwrap(
        () => api.v1.hub.today.items[':planItemId'].complete.$post({ param: { planItemId } }),
        'Could not complete that task.',
      ),
    invalidateKeys: [
      queryKeys.dailyPlanningDay(previousDate),
      queryKeys.dailyPlanningDay(date),
      queryKeys.dailyPlan(previousDate),
      queryKeys.today(date),
    ],
  });
}

/** Persist bulk choices about earlier unfinished daily work. */
export function useApplyDailyReview(date: string) {
  return useApiMutation({
    mutationFn: (
      decisions: {
        planItemId: string;
        action: 'today' | 'backlog' | 'done' | 'another';
        targetDate?: string;
      }[],
    ) =>
      unwrap(
        () =>
          api.v1['daily-plan'].day[':date'].review.$post({ param: { date }, json: { decisions } }),
        'Could not save your review.',
      ),
    invalidateKeys: [queryKeys.dailyPlanningDay(date), queryKeys.today(date)],
  });
}
