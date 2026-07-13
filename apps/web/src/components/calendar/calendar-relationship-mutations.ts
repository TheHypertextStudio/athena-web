'use client';

import type {
  CalendarItemRelationOut,
  CalendarItemTaskLinkCreate,
  CalendarItemTaskLinkOut,
  CalendarItemTaskLinkResultOut,
} from '@docket/types';
import { CalendarItemId, OrganizationId, TaskId } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

/** Variables for linking an existing task without the API mode discriminant. */
export type LinkExistingTaskVariables = Omit<
  Extract<CalendarItemTaskLinkCreate, { mode: 'link' }>,
  'mode'
>;

/** Link an existing task to a known calendar item. */
export function useLinkTaskToItem(itemId: string) {
  return useApiMutation<CalendarItemTaskLinkResultOut, LinkExistingTaskVariables>({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: itemId },
            json: { mode: 'link', ...vars },
          }),
        'Could not link the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}

/** Link an arbitrary dragged task to an arbitrary calendar target. */
export function useLinkTaskToCalendarItem() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemTaskLinkResultOut,
    {
      itemId: string;
      taskId: string;
      organizationId: string;
      role: 'contained' | 'related';
    }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: CalendarItemId.parse(vars.itemId) },
            json: {
              mode: 'link',
              taskId: TaskId.parse(vars.taskId),
              organizationId: OrganizationId.parse(vars.organizationId),
              role: vars.role,
            },
          }),
        'Could not add this task to the calendar item.',
      ),
    onSettled: async (_data, _error, vars) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(vars.itemId) });
    },
  });
}

/** Associate one owned calendar item with another target. */
export function useRelateCalendarItems() {
  const queryClient = useQueryClient();
  return useApiMutation<
    CalendarItemRelationOut,
    { sourceItemId: string; targetItemId: string; role: 'contained' | 'related' }
  >({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].relations.$post({
            param: { id: CalendarItemId.parse(vars.sourceItemId) },
            json: {
              targetItemId: CalendarItemId.parse(vars.targetItemId),
              role: vars.role,
            },
          }),
        'Could not relate these calendar items.',
      ),
    onSettled: async (_data, _error, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarItem(vars.sourceItemId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.calendarItemRelations(vars.sourceItemId),
        }),
      ]);
    },
  });
}

/** Remove one related or contained calendar item from a target. */
export function useDetachCalendarItemRelation(sourceItemId: string, targetItemId: string) {
  return useApiMutation<CalendarItemRelationOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].relations[':relatedItemId'].$delete({
            param: {
              id: CalendarItemId.parse(sourceItemId),
              relatedItemId: CalendarItemId.parse(targetItemId),
            },
          }),
        'Could not remove this calendar relationship.',
      ),
    invalidateKeys: [
      queryKeys.calendarItem(sourceItemId),
      queryKeys.calendarItemRelations(sourceItemId),
    ],
  });
}

/** Variables for creating and linking a task without the API mode discriminant. */
export type CreateAndLinkTaskVariables = Omit<
  Extract<CalendarItemTaskLinkCreate, { mode: 'create' }>,
  'mode'
>;

/** Create a new task and link it to a calendar item. */
export function useCreateAndLinkTask(itemId: string) {
  return useApiMutation<CalendarItemTaskLinkResultOut, CreateAndLinkTaskVariables>({
    mutationFn: (vars) =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks.$post({
            param: { id: itemId },
            json: { mode: 'create', ...vars },
          }),
        'Could not create and link the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}

/** Detach a task from a calendar item. */
export function useDetachTaskFromItem(itemId: string, taskId: string) {
  return useApiMutation<CalendarItemTaskLinkOut, undefined>({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.me.calendar.items[':id'].tasks[':taskId'].$delete({
            param: { id: itemId, taskId },
          }),
        'Could not detach the task.',
      ),
    invalidateKeys: [queryKeys.calendarItem(itemId)],
  });
}
