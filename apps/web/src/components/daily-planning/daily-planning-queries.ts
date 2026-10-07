'use client';

/** Typed reads and writes for the focused daily planning flow. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { SearchOut } from '@/lib/contracts/search';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/** Resolve a date-less planning entry in the person's saved timezone. */
export function useDailyPlanningPreferences() {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load your workday settings.',
    ),
  );
}

/** Read one day, including its accepted history and actual work. */
export function useDailyPlanningDay(date: string, enabled = true) {
  return useApiQuery(
    apiQueryOptions(
      queryKeys.dailyPlanningDay(date),
      () => api.v1['daily-plan'].day[':date'].$get({ param: { date } }),
      'Could not load this day.',
      { enabled },
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
      expectedRevision,
    }: {
      draft: DailyPlanSnapshot;
      resumeStep: 'review_yesterday' | 'plan_today' | 'review_plan';
      expectedRevision?: number;
    }) =>
      unwrap(
        () =>
          api.v1['daily-plan'].day[':date'].draft.$put({
            param: { date },
            json: { draft, resumeStep, expectedRevision },
          }),
        'Could not save your plan.',
      ),
    invalidateKeys: [queryKeys.dailyPlanningDay(date)],
  });
}

/** Build a read-only proposed schedule without changing the saved or accepted plan. */
export function useDailyPlanProposal(date: string) {
  return useApiMutation({
    mutationFn: (input: { draft?: DailyPlanSnapshot; expectedRevision?: number }) =>
      unwrap(
        () => api.v1['daily-plan'].day[':date'].proposal.$post({ param: { date }, json: input }),
        'Could not organize this day.',
      ),
  });
}

/** Accept the saved draft without starting work. */
export function useConfirmDailyPlan(date: string) {
  return useApiMutation({
    mutationFn: (input: { expectedRevision?: number } | undefined) =>
      unwrap(
        () =>
          api.v1['daily-plan'].day[':date'].confirm.$post({
            param: { date },
            json: input ?? {},
          }),
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

/** Place explicitly deferred work on another day's docket without changing task completion. */
export function useDeferDailyTask(date: string) {
  return useApiMutation({
    mutationFn: (input: { taskId: string; organizationId: string; targetDate: string }) =>
      unwrap(
        () =>
          api.v1['daily-plan'].$post({
            json: {
              refTaskId: input.taskId,
              refOrganizationId: input.organizationId,
              date: input.targetDate,
            },
          }),
        'Could not move this work.',
      ),
    invalidateKeys: [queryKeys.dailyPlanningDay(date), queryKeys.today(date)],
  });
}
