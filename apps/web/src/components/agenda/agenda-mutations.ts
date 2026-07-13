'use client';

/**
 * `agenda/agenda-mutations` — the agenda's write layer.
 *
 * @remarks
 * Every in-place edit to a day's plan goes through the Hub daily-plan CRUD. Status changes only
 * patch the daily-plan metadata that owns completion state. Timebox changes, removals, and moves
 * patch all three rendered projections — daily plan, combined Agenda, and Hub Today — before those
 * caches reconcile with the server. Keeping the public write API here leaves {@link AgendaProvider}
 * to own only read and navigation state.
 *
 * The contract follows the API: a daily-plan item's `date` is immutable, so "move to another day" is
 * the documented *remove-and-re-add* (POST the task onto the target day, then DELETE the old item),
 * not a field update.
 */
import type { AgendaOut, DailyPlanItemOut, DailyPlanItemStatus, HubTodayOut } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { CALENDAR_ITEMS_PREFIX } from '@/components/calendar/calendar-mutation-cache';
import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';

import type { AgendaEntry } from './agenda-context';
import { useAgendaTimeboxMutation } from './agenda-timebox-mutation';

/** The agenda's in-place edit operations, each acting on a single plan entry. */
export interface AgendaPlanMutations {
  /** Whether the latest timebox write failed after its optimistic update was restored. */
  timeboxFailed: boolean;
  /** Clear a previous timebox failure before another inline scheduling action starts. */
  clearTimeboxFailure: () => void;
  /** Check an entry off for the day (or un-check it). */
  toggleDone: (entry: AgendaEntry) => void;
  /** Place the entry on the timeline for the given local clock window (ISO instants). */
  setTimebox: (entry: AgendaEntry, startsAt: string, endsAt: string) => void;
  /** Remove the entry's timebox, returning it to the untimed ("Anytime") set. */
  clearTimebox: (entry: AgendaEntry) => void;
  /** Move the entry to another day (re-adds it there, unscheduled, and unplans it from this day). */
  moveToDay: (entry: AgendaEntry, targetDate: string) => void;
  /** Unplan the entry for the day (the underlying task is untouched). */
  removeFromPlan: (entry: AgendaEntry) => void;
}

/** The cached shape of the daily-plan read (`GET /daily-plan`). */
interface DailyPlanCache {
  items: DailyPlanItemOut[];
}

/** A planned task agenda entry, narrowed to the ids required by daily-plan mutations. */
type EditableTaskEntry = AgendaEntry & {
  source: 'task';
  taskId: string;
  organizationId: string;
  planItemId: string;
};

/** Combine several optimistic patches into one rollback that undoes them all. */
function combineRollbacks(...patches: { rollback: () => void }[]): { rollback: () => void } {
  return {
    rollback: () => {
      for (const patch of [...patches].reverse()) patch.rollback();
    },
  };
}

/** Narrow agenda entries to the planned task rows this write layer can edit. */
function editableTask(entry: AgendaEntry): EditableTaskEntry | null {
  if (entry.source !== 'task' || !entry.taskId || !entry.organizationId || !entry.planItemId) {
    return null;
  }
  return entry as EditableTaskEntry;
}

/** Remove a task from the combined agenda cache while preserving external calendar entries. */
function removeAgendaTask(
  entries: readonly AgendaOut['entries'][number][],
  taskId: string,
): AgendaOut['entries'] {
  return entries.filter((entry) => entry.kind !== 'task_timebox' || entry.taskId !== taskId);
}

/**
 * Bind the day's plan-item edit operations to the active client.
 *
 * @remarks
 * Completion status is optimistic only in `dailyPlan(date)`, its owning projection. Timebox and
 * removal writes optimistically update `dailyPlan(date)`, `agenda(date)`, and `today(date)`; moves
 * remove from those current-day projections and reconcile the target day's three projections.
 *
 * @param date - The day these edits apply to (the cache keys they patch + invalidate).
 */
export function useAgendaPlanMutations(date: string): AgendaPlanMutations {
  const queryClient = useQueryClient();
  const dayKeys = useMemo(
    () => [queryKeys.dailyPlan(date), queryKeys.agenda(date), queryKeys.today(date)],
    [date],
  );

  const status = useApiMutation({
    mutationFn: (vars: { id: string; status: DailyPlanItemStatus }) =>
      unwrap(
        () =>
          api.v1['daily-plan'][':id'].$patch({
            param: { id: vars.id },
            json: { status: vars.status },
          }),
        'Could not update your plan.',
      ),
    onMutate: (vars) =>
      optimisticPatch<DailyPlanCache>(queryClient, queryKeys.dailyPlan(date), (prev) => ({
        items: prev.items.map((item) =>
          item.id === vars.id ? { ...item, status: vars.status } : item,
        ),
      })),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: dayKeys,
  });

  const timebox = useAgendaTimeboxMutation(date);

  const remove = useApiMutation({
    mutationFn: (vars: { id: string; taskId: string }) =>
      unwrap(
        () => api.v1['daily-plan'][':id'].$delete({ param: { id: vars.id } }),
        'Could not remove the task from your plan.',
      ),
    onMutate: (vars) =>
      combineRollbacks(
        optimisticPatch<DailyPlanCache>(queryClient, queryKeys.dailyPlan(date), (prev) => ({
          items: prev.items.filter((item) => item.id !== vars.id),
        })),
        optimisticPatch<AgendaOut>(queryClient, queryKeys.agenda(date), (prev) => ({
          ...prev,
          entries: removeAgendaTask(prev.entries, vars.taskId),
        })),
        optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (prev) => ({
          ...prev,
          plan: prev.plan.filter((task) => task.id !== vars.taskId),
          calendar: prev.calendar.filter((block) => block.taskId !== vars.taskId),
        })),
      ),
    onError: (_error, _vars, context) => context?.rollback(),
    invalidateKeys: [...dayKeys, CALENDAR_ITEMS_PREFIX],
  });

  const move = useApiMutation({
    mutationFn: async (vars: {
      id: string;
      taskId: string;
      organizationId: string;
      targetDate: string;
    }) => {
      await unwrap(
        () =>
          api.v1['daily-plan'].$post({
            json: {
              refOrganizationId: vars.organizationId,
              refTaskId: vars.taskId,
              date: vars.targetDate,
            },
          }),
        'Could not move the task.',
      );
      return unwrap(
        () => api.v1['daily-plan'][':id'].$delete({ param: { id: vars.id } }),
        'Could not move the task.',
      );
    },
    // Optimistically drop it from *this* day; the target day reconciles via invalidation below.
    onMutate: (vars) =>
      combineRollbacks(
        optimisticPatch<DailyPlanCache>(queryClient, queryKeys.dailyPlan(date), (prev) => ({
          items: prev.items.filter((item) => item.id !== vars.id),
        })),
        optimisticPatch<AgendaOut>(queryClient, queryKeys.agenda(date), (prev) => ({
          ...prev,
          entries: removeAgendaTask(prev.entries, vars.taskId),
        })),
        optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (prev) => ({
          ...prev,
          plan: prev.plan.filter((task) => task.id !== vars.taskId),
          calendar: prev.calendar.filter((block) => block.taskId !== vars.taskId),
        })),
      ),
    onError: (_error, _vars, context) => context?.rollback(),
    // The current day is invalidated via `invalidateKeys`; the target day's keys are dynamic
    // (per-call `targetDate`), so they're invalidated here in `onSettled` (runs before that).
    onSettled: async (_data, _error, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dailyPlan(vars.targetDate) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agenda(vars.targetDate) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today(vars.targetDate) }),
      ]);
    },
    invalidateKeys: [...dayKeys, CALENDAR_ITEMS_PREFIX],
  });

  const toggleDone = useCallback(
    (entry: AgendaEntry) => {
      const task = editableTask(entry);
      if (!task) return;
      status.mutate({ id: task.planItemId, status: task.done ? 'planned' : 'done' });
    },
    [status],
  );
  const setTimebox = useCallback(
    (entry: AgendaEntry, startsAt: string, endsAt: string) => {
      const task = editableTask(entry);
      if (!task) return;
      timebox.mutate({
        id: task.planItemId,
        taskId: task.taskId,
        organizationId: task.organizationId,
        startsAt,
        endsAt,
      });
    },
    [timebox],
  );
  const clearTimebox = useCallback(
    (entry: AgendaEntry) => {
      const task = editableTask(entry);
      if (!task) return;
      timebox.mutate({
        id: task.planItemId,
        taskId: task.taskId,
        organizationId: task.organizationId,
        startsAt: null,
        endsAt: null,
      });
    },
    [timebox],
  );
  const resetTimebox = timebox.reset;
  const clearTimeboxFailure = useCallback(() => {
    resetTimebox();
  }, [resetTimebox]);
  const moveToDay = useCallback(
    (entry: AgendaEntry, targetDate: string) => {
      const task = editableTask(entry);
      if (!task || targetDate === date) return;
      move.mutate({
        id: task.planItemId,
        taskId: task.taskId,
        organizationId: task.organizationId,
        targetDate,
      });
    },
    [move, date],
  );
  const removeFromPlan = useCallback(
    (entry: AgendaEntry) => {
      const task = editableTask(entry);
      if (!task) return;
      remove.mutate({ id: task.planItemId, taskId: task.taskId });
    },
    [remove],
  );

  return useMemo(
    () => ({
      timeboxFailed: timebox.isError,
      clearTimeboxFailure,
      toggleDone,
      setTimebox,
      clearTimebox,
      moveToDay,
      removeFromPlan,
    }),
    [
      timebox.isError,
      clearTimeboxFailure,
      toggleDone,
      setTimebox,
      clearTimebox,
      moveToDay,
      removeFromPlan,
    ],
  );
}
