'use client';

/**
 * Queue-backed optimistic writes for Agenda task timeboxes.
 *
 * @remarks
 * A timebox is projected into three independently-read caches: daily-plan metadata, the combined
 * Agenda feed, and Hub Today's calendar. The queue prevents overlapping whole-cache snapshots
 * from letting an older rollback overwrite a newer edit. Setup is transactional: if any cache
 * patch throws, earlier patches are reversed before the queue lease is released.
 */
import {
  type AgendaOut,
  type DailyPlanItemOut,
  type HubTodayOut,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { type DefaultError, type UseMutationResult, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { optimisticPatch, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { acquireSerializedOptimisticWrite } from '@/lib/serialized-optimistic-write';

/** Timebox fields required to update every Agenda cache projection. */
interface AgendaTimeboxVariables {
  id: string;
  taskId: string;
  organizationId: string;
  startsAt: string | null;
  endsAt: string | null;
}

/** The cached shape of the daily-plan read (`GET /daily-plan`). */
interface DailyPlanCache {
  items: DailyPlanItemOut[];
}

/** A calendar block on the Hub `today` projection. */
type CalendarBlock = HubTodayOut['calendar'][number];

/** A task timebox in the combined Agenda projection. */
type AgendaTaskTimebox = Extract<AgendaOut['entries'][number], { kind: 'task_timebox' }>;

/** Rollback state held until the serialized timebox write settles. */
interface AgendaTimeboxContext {
  rollback: () => void;
  releaseQueue: () => void;
}

/** Roll back optimistic patches in reverse application order. */
function rollbackAll(patches: readonly { rollback: () => void }[]): void {
  for (const patch of [...patches].reverse()) patch.rollback();
}

/** Upsert or remove a task block in Hub Today's calendar projection. */
function projectTodayCalendar(
  calendar: readonly CalendarBlock[],
  block: AgendaTimeboxVariables,
): CalendarBlock[] {
  const withoutTask = calendar.filter((candidate) => candidate.taskId !== block.taskId);
  if (!block.startsAt || !block.endsAt) return withoutTask;
  return [
    ...withoutTask,
    {
      taskId: TaskId.parse(block.taskId),
      organizationId: OrganizationId.parse(block.organizationId),
      startsAt: block.startsAt,
      endsAt: block.endsAt,
    },
  ];
}

/** Update or remove a task timebox in the combined Agenda projection. */
function projectAgendaEntries(
  entries: readonly AgendaOut['entries'][number][],
  block: AgendaTimeboxVariables,
): AgendaOut['entries'] {
  return entries.flatMap((entry) => {
    if (entry.kind !== 'task_timebox' || entry.taskId !== block.taskId) return [entry];
    if (!block.startsAt || !block.endsAt) return [];
    return [
      { ...entry, startsAt: block.startsAt, endsAt: block.endsAt } satisfies AgendaTaskTimebox,
    ];
  });
}

/**
 * Create the serialized timebox mutation for one Agenda date.
 *
 * @param date - Date whose daily-plan, Agenda, and Hub Today projections are updated.
 * @returns A TanStack mutation result used by {@link useAgendaPlanMutations}.
 */
export function useAgendaTimeboxMutation(
  date: string,
): UseMutationResult<DailyPlanItemOut, DefaultError, AgendaTimeboxVariables, AgendaTimeboxContext> {
  const queryClient = useQueryClient();
  const dayKeys = [queryKeys.dailyPlan(date), queryKeys.agenda(date), queryKeys.today(date)];

  return useApiMutation<DailyPlanItemOut, AgendaTimeboxVariables, AgendaTimeboxContext>({
    mutationFn: (vars) =>
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
          optimisticPatch<DailyPlanCache>(queryClient, queryKeys.dailyPlan(date), (previous) => ({
            items: previous.items.map((item) =>
              item.id === vars.id
                ? { ...item, timeboxStartsAt: vars.startsAt, timeboxEndsAt: vars.endsAt }
                : item,
            ),
          })),
        );
        applied.push(
          optimisticPatch<AgendaOut>(queryClient, queryKeys.agenda(date), (previous) => ({
            ...previous,
            entries: projectAgendaEntries(previous.entries, vars),
          })),
        );
        applied.push(
          optimisticPatch<HubTodayOut>(queryClient, queryKeys.today(date), (previous) => ({
            ...previous,
            calendar: projectTodayCalendar(previous.calendar, vars),
          })),
        );
        return {
          rollback: () => {
            rollbackAll(applied);
          },
          releaseQueue: lease.release,
        };
      } catch (error) {
        rollbackAll(applied);
        lease.release();
        throw error;
      }
    },
    onError: (_error, _vars, context) => {
      context?.rollback();
    },
    onSettled: async (_data, _error, _vars, context) => {
      try {
        await Promise.all(dayKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      } finally {
        context?.releaseQueue();
      }
    },
  });
}
