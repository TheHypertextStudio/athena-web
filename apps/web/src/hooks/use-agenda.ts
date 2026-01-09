/**
 * Agenda data hooks using TanStack Query.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agendaApi, agendaKeys, type AgendaItem } from '@/lib/agenda-api';

/**
 * Hook for fetching today's agenda.
 */
export function useAgendaToday() {
  return useQuery({
    queryKey: agendaKeys.today(),
    queryFn: () => agendaApi.getToday(),
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook for fetching agenda for a specific date.
 */
export function useAgendaDay(date: string) {
  return useQuery({
    queryKey: agendaKeys.day(date),
    queryFn: () => agendaApi.getDay(date),
    staleTime: 30_000,
  });
}

/**
 * Hook for fetching weekly agenda.
 */
export function useWeeklyAgenda(startDate: string) {
  return useQuery({
    queryKey: agendaKeys.week(startDate),
    queryFn: () => agendaApi.getWeek(startDate),
    staleTime: 60_000, // 1 minute for weekly view
  });
}

/**
 * Hook for fetching upcoming deadlines.
 */
export function useDeadlines(days = 7) {
  return useQuery({
    queryKey: agendaKeys.deadlines(days),
    queryFn: () => agendaApi.getDeadlines(days),
    staleTime: 60_000,
  });
}

/**
 * Hook for reordering tasks with optimistic updates.
 */
export function useReorderTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskIds, date }: { taskIds: string[]; date: string }) =>
      agendaApi.reorderTasks(taskIds, date),

    onMutate: async ({ taskIds, date }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: agendaKeys.day(date) });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(agendaKeys.day(date));

      // Optimistically update to the new order
      queryClient.setQueryData(agendaKeys.day(date), (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const oldData = old as { data?: { items?: AgendaItem[] } };
        if (!oldData.data?.items) return old;

        const taskItems = oldData.data.items.filter((i) => i.type === 'task');
        const eventItems = oldData.data.items.filter((i) => i.type === 'event');

        // Reorder tasks according to taskIds
        const reorderedTasks = taskIds
          .map((id) => taskItems.find((t) => (t.data as { id: string }).id === id))
          .filter((t): t is AgendaItem => t !== undefined)
          .map((item, index) => ({ ...item, customPosition: index }));

        return {
          ...oldData,
          data: {
            ...oldData.data,
            items: [...reorderedTasks, ...eventItems],
          },
        };
      });

      return { previousData };
    },

    onError: (_err, { date }, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(agendaKeys.day(date), context.previousData);
      }
    },

    onSettled: (_data, _error, { date }) => {
      // Refetch to ensure server state
      void queryClient.invalidateQueries({ queryKey: agendaKeys.day(date) });
    },
  });
}

/**
 * Get formatted date string for today.
 */
export function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the start of the current week (Monday).
 */
export function getWeekStartDate(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Format a date for display.
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Check if a date is today.
 */
export function isToday(dateString: string): boolean {
  return dateString === getTodayDate();
}
