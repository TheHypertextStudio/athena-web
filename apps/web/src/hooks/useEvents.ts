/**
 * Events data hooks using TanStack Query.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eventsApi, eventKeys, type Event, type CreateEventInput } from '@/lib/api-client';
import { useUndoableMutation } from '@/lib/undo';

/**
 * Hook for fetching events within a date range.
 */
export function useEvents(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: eventKeys.list(params),
    queryFn: () => eventsApi.list(params),
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook for fetching a single event by ID.
 */
export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: () => eventsApi.get(id),
    enabled: !!id,
  });
}

/**
 * Hook for creating an event.
 */
export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateEventInput) => eventsApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

/**
 * Hook for updating an event with optimistic updates.
 */
export function useUpdateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateEventInput> }) =>
      eventsApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: eventKeys.detail(id) });

      // Snapshot the previous value
      const previousEvent = queryClient.getQueryData<{ data: Event }>(eventKeys.detail(id));

      // Optimistically update the cache
      if (previousEvent) {
        queryClient.setQueryData(eventKeys.detail(id), {
          data: { ...previousEvent.data, ...data },
        });
      }

      return { previousEvent };
    },
    onError: (_err, { id }, context) => {
      // Rollback on error
      if (context?.previousEvent) {
        queryClient.setQueryData(eventKeys.detail(id), context.previousEvent);
      }
    },
    onSettled: (_data, _error, { id }) => {
      // Refetch to ensure server state
      void queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

/**
 * Hook for deleting an event.
 */
export function useDeleteEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => eventsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
    },
  });
}

// =============================================================================
// Undoable Mutations
// =============================================================================

/**
 * Hook for creating an event with undo support.
 */
export function useUndoableCreateEvent() {
  return useUndoableMutation<{ data: Event }, Error, CreateEventInput>(
    (data) => eventsApi.create(data),
    {
      entityType: 'event',
      operationType: 'create',
      descriptionTemplate: (input) => `Event "${input.title}" created`,
      getEntityId: (_input, result) => result?.data.id ?? '',
      getQueryKeys: () => [eventKeys.lists()],
      getSnapshotData: (result) => result.data,
    },
  );
}

/**
 * Hook for updating an event with undo support.
 */
export function useUndoableUpdateEvent() {
  const queryClient = useQueryClient();

  return useUndoableMutation<
    { data: Event },
    Error,
    { id: string; data: Partial<CreateEventInput> },
    { previousData?: Event }
  >(
    ({ id, data }) => eventsApi.update(id, data),
    {
      entityType: 'event',
      operationType: 'update',
      descriptionTemplate: 'Event updated',
      getEntityId: (input) => input.id,
      getQueryKeys: (input) => [eventKeys.detail(input.id), eventKeys.lists()],
      getSnapshotData: (result) => result.data,
    },
    {
      onMutate: async ({ id, data }) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries({ queryKey: eventKeys.detail(id) });

        // Snapshot the previous value
        const previousEvent = queryClient.getQueryData<{ data: Event }>(eventKeys.detail(id));

        // Optimistically update the cache
        if (previousEvent) {
          queryClient.setQueryData(eventKeys.detail(id), {
            data: { ...previousEvent.data, ...data },
          });
        }

        return { previousData: previousEvent?.data };
      },
      onError: (_err, { id }, context) => {
        // Rollback on error
        if (context?.previousData) {
          queryClient.setQueryData(eventKeys.detail(id), { data: context.previousData });
        }
      },
      onSettled: (_data, _error, { id }) => {
        // Refetch to ensure server state
        void queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) });
        void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      },
    },
  );
}

/**
 * Hook for deleting an event with undo support.
 *
 * Note: To enable undo for deletes, we need to fetch the event data before deletion.
 */
export function useUndoableDeleteEvent() {
  const queryClient = useQueryClient();

  return useUndoableMutation<
    unknown,
    Error,
    { id: string; eventData: Event },
    { previousData?: Event }
  >(
    ({ id }) => eventsApi.delete(id),
    {
      entityType: 'event',
      operationType: 'delete',
      descriptionTemplate: (input) => `Event "${input.eventData.title}" deleted`,
      getEntityId: (input) => input.id,
      getQueryKeys: () => [eventKeys.lists()],
    },
    {
      onMutate: ({ eventData }) => {
        return { previousData: eventData };
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
      },
    },
  );
}

/**
 * Hook for fetching events for a specific day.
 * Uses full ISO timestamps to properly filter across timezone boundaries.
 */
export function useEventsForDay(date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setHours(0, 0, 0, 0);

  return useEvents({
    startDate: dayStart.toISOString(),
    endDate: dayEnd.toISOString(),
  });
}
