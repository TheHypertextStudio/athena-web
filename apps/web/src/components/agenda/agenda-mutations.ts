'use client';

/**
 * `agenda/agenda-mutations` — the agenda's write layer.
 *
 * @remarks
 * Every in-place edit to a day's plan goes through the Hub daily-plan CRUD, optimistically patches
 * the three caches the agenda reads — the `dailyPlan` items (ids + status + timebox), the combined
 * `agenda` entries, and the Hub `today` projection (`plan`/`calendar`) — and invalidates them so the
 * cache reconciles with the server on settle. Keeping the writes here leaves {@link AgendaProvider}
 * to own only read + navigation state.
 *
 * The contract follows the API: a daily-plan item's `date` is immutable, so "move to another day" is
 * the documented *remove-and-re-add* (POST the task onto the target day, then DELETE the old item),
 * not a field update.
 */
import type { AgendaOut, DailyPlanItemOut, DailyPlanItemStatus, HubTodayOut } from '@docket/types';
import { OrganizationId, TaskId } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { acquireSerializedOptimisticWrite } from '@/lib/serialized-optimistic-write';

import type { AgendaEntry } from './agenda-context';

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

/** A calendar block on the Hub `today` projection (drives the timeline). */
type CalendarBlock = HubTodayOut['calendar'][number];

/** A task timebox entry in the combined agenda cache. */
type AgendaTaskTimebox = Extract<AgendaOut['entries'][number], { kind: 'task_timebox' }>;

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

/** Upsert (when timeboxed) or drop (when cleared) a task's block on the `today` calendar. */
function nextCalendar(
  calendar: readonly CalendarBlock[],
  block: { taskId: string; organizationId: string; startsAt: string | null; endsAt: string | null },
): CalendarBlock[] {
  const without = calendar.filter((b) => b.taskId !== block.taskId);
  if (block.startsAt && block.endsAt) {
    return [
      ...without,
      {
        // The ids come from an `AgendaEntry` (widened to `string`); re-brand them through the
        // schemas to match the calendar block's branded shape (the codebase's `Id.parse` idiom).
        taskId: TaskId.parse(block.taskId),
        organizationId: OrganizationId.parse(block.organizationId),
        startsAt: block.startsAt,
        endsAt: block.endsAt,
      },
    ];
  }
  return without;
}

/** Update or remove a task timebox entry in the combined agenda cache. */
function nextAgendaEntries(
  entries: readonly AgendaOut['entries'][number][],
  block: { taskId: string; startsAt: string | null; endsAt: string | null },
): AgendaOut['entries'] {
  return entries.flatMap((entry) => {
    if (entry.kind !== 'task_timebox' || entry.taskId !== block.taskId) return [entry];
    if (!block.startsAt || !block.endsAt) return [];
    return [
      { ...entry, startsAt: block.startsAt, endsAt: block.endsAt } satisfies AgendaTaskTimebox,
    ];
  });
}

/** Remove a task from the combined agenda cache while preserving external calendar entries. */
function removeAgendaTask(
  entries: readonly AgendaOut['entries'][number][],
  taskId: string,
): AgendaOut['entries'] {
  return entries.filter((entry) => entry.kind !== 'task_timebox' || entry.taskId !== taskId);
}

/**
 * Bind the day's plan-item edit operations to the active client, optimistically patching the
 * `dailyPlan(date)`, `agenda(date)`, and `today(date)` caches so each edit lands instantly.
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

  const timebox = useApiMutation({
    mutationFn: (vars: {
      id: string;
      taskId: string;
      organizationId: string;
      startsAt: string | null;
      endsAt: string | null;
    }) =>
      unwrap(
        () =>
          api.v1['daily-plan'][':id'].$patch({
            param: { id: vars.id },
            json: { timeboxStartsAt: vars.startsAt, timeboxEndsAt: vars.endsAt },
          }),
        'Could not update the timebox.',
      ),
    onMutate: async (vars) => {
      const lease = await acquireSerializedOptimisticWrite(queryClient, `agenda-timebox:${date}`);
      const applied: { rollback: () => void }[] = [];
      try {
        applied.push(
          optimisticPatch<DailyPlanCache>(queryClient, queryKeys.dailyPlan(date), (prev) => ({
            items: prev.items.map((item) =>
              item.id === vars.id
                ? { ...item, timeboxStartsAt: vars.startsAt, timeboxEndsAt: vars.endsAt }
                : item,
            ),
          })),
        );
        applied.push(
          optimisticPatch<AgendaOut>(queryClient, queryKeys.agenda(date), (prev) => ({
            ...prev,
            entries: nextAgendaEntries(prev.entries, vars),
          })),
        );
        applied.push(
          optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (prev) => ({
            ...prev,
            calendar: nextCalendar(prev.calendar, vars),
          })),
        );
        return {
          ...combineRollbacks(...applied),
          releaseQueue: lease.release,
        };
      } catch (error) {
        combineRollbacks(...applied).rollback();
        lease.release();
        throw error;
      }
    },
    onError: (_error, _vars, context) => context?.rollback(),
    onSettled: async (_data, _error, _vars, context) => {
      try {
        await Promise.all(dayKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      } finally {
        context?.releaseQueue();
      }
    },
  });

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
    invalidateKeys: dayKeys,
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
    invalidateKeys: dayKeys,
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
