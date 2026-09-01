'use client';

import type { HubTodayOut, HubTodayPlanItem, HubTodaySuggestion } from '../../../lib/contracts/hub';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { useAgendaTimeboxMutation } from '@/components/agenda/agenda-timebox-mutation';
import { CALENDAR_ITEMS_PREFIX } from '@/components/calendar/calendar-mutation-cache';
import { useTimerControls } from '@/components/time-tracking/use-timer';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Inline actions available from Today without reproducing detailed workflows. */
export interface TodayActions {
  readonly completing: boolean;
  readonly suggestionBusy: boolean;
  readonly error: string | null;
  readonly complete: (item: HubTodayPlanItem) => void;
  readonly defer: (item: HubTodayPlanItem) => void;
  readonly promote: (item: HubTodayPlanItem, beforeSort: number) => void;
  readonly timebox: (item: HubTodayPlanItem, startsAt: string, endsAt: string) => Promise<void>;
  readonly add: (item: HubTodaySuggestion) => void;
  readonly start: (item: HubTodaySuggestion) => void;
}

function withPromotedItem(previous: HubTodayOut, planItemId: string): HubTodayOut {
  const beforePosition = previous.focus.now?.position ?? 0;
  const plan = previous.plan
    .map((item) =>
      item.planItemId === planItemId ? { ...item, position: beforePosition - 1 } : item,
    )
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((item, index) => ({
      ...item,
      position: index,
      reason: null,
    }));
  const planned = plan.filter((item) => item.planStatus === 'planned');
  const actionable = planned.filter((item) => !item.blocked);
  return {
    ...previous,
    plan,
    focus: { now: actionable[0] ?? null, after: actionable[1] ?? null },
  };
}

function withoutItem(previous: HubTodayOut, planItemId: string): HubTodayOut {
  const removed = previous.plan.find((item) => item.planItemId === planItemId);
  const plan = previous.plan.filter((item) => item.planItemId !== planItemId);
  const planned = plan.filter((item) => item.planStatus === 'planned');
  const actionable = planned.filter((item) => !item.blocked);
  return {
    ...previous,
    plan,
    planState: planned.length > 0 ? 'active' : 'cleared',
    focus: { now: actionable[0] ?? null, after: actionable[1] ?? null },
    calendar: removed
      ? previous.calendar.filter((block) => block.taskId !== removed.id)
      : previous.calendar,
  };
}

/** Bind semantic Today mutations and shared cache invalidation to one date. */
export function useTodayActions(date: string): TodayActions {
  const queryClient = useQueryClient();
  const timer = useTimerControls(null);
  const timeboxMutation = useAgendaTimeboxMutation(date);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const dayKeys = [
    queryKeys.today(date),
    queryKeys.dailyPlan(date),
    queryKeys.agenda(date),
    queryKeys.dayDirective(date),
    queryKeys.dayStart(date),
    CALENDAR_ITEMS_PREFIX,
  ] as const;

  const completeMutation = useApiMutation({
    mutationFn: (item: HubTodayPlanItem) =>
      unwrap(
        () =>
          api.v1.hub.today.items[':planItemId'].complete.$post({
            param: { planItemId: item.planItemId },
          }),
        'Could not complete that task.',
      ),
    onMutate: (item) =>
      optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (previous) =>
        withoutItem(previous, item.planItemId),
      ),
    onError: (_error, _item, context) => context?.rollback(),
    onSettled: (_data, _error, item) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.task(item.organizationId, item.id) }),
    invalidateKeys: dayKeys,
  });

  const deferMutation = useApiMutation({
    mutationFn: (item: HubTodayPlanItem) =>
      unwrap(
        () => api.v1['daily-plan'][':id'].$delete({ param: { id: item.planItemId } }),
        'Could not defer that task.',
      ),
    onMutate: (item) =>
      optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (previous) =>
        withoutItem(previous, item.planItemId),
      ),
    onError: (_error, _item, context) => context?.rollback(),
    onSettled: (_data, _error, item) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.task(item.organizationId, item.id) }),
    invalidateKeys: dayKeys,
  });

  const promoteMutation = useApiMutation({
    mutationFn: (vars: { item: HubTodayPlanItem; beforeSort: number }) =>
      unwrap(
        () =>
          api.v1['daily-plan'][':id'].$patch({
            param: { id: vars.item.planItemId },
            json: { sort: vars.beforeSort - 1 },
          }),
        'Could not reorder your plan.',
      ),
    onMutate: (vars) =>
      optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (previous) =>
        withPromotedItem(previous, vars.item.planItemId),
      ),
    onError: (_error, _vars, context) => context?.rollback(),
    onSettled: (_data, _error, vars) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.task(vars.item.organizationId, vars.item.id),
      }),
    invalidateKeys: dayKeys,
  });

  const addMutation = useApiMutation({
    mutationFn: (vars: { item: HubTodaySuggestion; placement: 'now' | 'next' }) => {
      const plan = queryClient.getQueryData<HubTodayOut>(queryKeys.today(date))?.plan ?? [];
      const positions = plan.map((item) => item.sort);
      const sort =
        vars.placement === 'now' ? Math.min(0, ...positions) - 1 : Math.max(-1, ...positions) + 1;
      return unwrap(
        () =>
          api.v1['daily-plan'].$post({
            json: {
              refOrganizationId: vars.item.organizationId,
              refTaskId: vars.item.id,
              date,
              sort,
            },
          }),
        'Could not add that task to today.',
      );
    },
    onSettled: (_data, _error, vars) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.task(vars.item.organizationId, vars.item.id),
      }),
    invalidateKeys: dayKeys,
  });

  const start = useCallback(
    (item: HubTodaySuggestion): void => {
      setStartError(null);
      setStarting(true);
      void (async () => {
        try {
          await addMutation.mutateAsync({ item, placement: 'now' });
        } catch {
          // The shared mutation exposes its application-owned error below.
          setStarting(false);
          return;
        }
        try {
          await timer.start({
            taskId: item.id,
            organizationId: item.organizationId,
            label: item.title,
          });
        } catch {
          setStartError('Added to Today, but tracking did not start.');
        } finally {
          setStarting(false);
        }
      })();
    },
    [addMutation, timer],
  );

  const timebox = useCallback(
    async (item: HubTodayPlanItem, startsAt: string, endsAt: string): Promise<void> => {
      try {
        await timeboxMutation.mutateAsync({
          id: item.planItemId,
          taskId: item.id,
          organizationId: item.organizationId,
          startsAt,
          endsAt,
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.dayDirective(date) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.dayStart(date) }),
          queryClient.invalidateQueries({
            queryKey: queryKeys.task(item.organizationId, item.id),
          }),
        ]);
      } catch {
        // The shared mutation owns rollback and exposes application-owned copy below.
      }
    },
    [date, queryClient, timeboxMutation],
  );

  const mutationError =
    completeMutation.error ??
    deferMutation.error ??
    promoteMutation.error ??
    addMutation.error ??
    timeboxMutation.error;
  return {
    completing: completeMutation.isPending,
    suggestionBusy: addMutation.isPending || starting,
    error:
      startError ??
      (mutationError ? userErrorMessage(mutationError, 'Could not update today.') : null),
    complete: (item) => {
      completeMutation.mutate(item);
    },
    defer: (item) => {
      deferMutation.mutate(item);
    },
    promote: (item, beforeSort) => {
      promoteMutation.mutate({ item, beforeSort });
    },
    timebox,
    add: (item) => {
      addMutation.mutate({ item, placement: 'next' });
    },
    start,
  };
}
