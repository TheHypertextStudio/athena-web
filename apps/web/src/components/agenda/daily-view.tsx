/**
 * Daily agenda view component.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAgendaToday, useReorderTasks, isToday, getTodayDate } from '@/hooks/use-agenda';
import { agendaKeys } from '@/lib/agenda-api';
import type { Task, Event } from '@/lib/api-client';
import { TimeUtilization } from './time-utilization';
import { SortableTaskList } from './sortable-task-list';
import { AgendaTaskItem } from './agenda-task-item';
import { AgendaEventItem } from './agenda-event-item';
import { QuickCreateTask, QuickCreateEvent } from './quick-create';
import { Skeleton } from '@/components/ui/skeleton';

interface DailyViewProps {
  /** The date to display (YYYY-MM-DD) */
  date: string;
}

/**
 * Daily view showing today's tasks and events.
 */
export function DailyView({ date }: DailyViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAgendaToday();
  const reorderMutation = useReorderTasks();

  // Only show today's data if the date is today
  // For other dates, we'd use useAgendaDay(date) instead
  const showTodayView = isToday(date);

  const handleTaskStatusChange = useCallback(
    (_taskId: string, _completed: boolean) => {
      // Invalidate queries to refetch data
      void queryClient.invalidateQueries({ queryKey: agendaKeys.today() });
      void queryClient.invalidateQueries({ queryKey: agendaKeys.day(date) });
    },
    [queryClient, date],
  );

  const handleReorder = useCallback(
    (taskIds: string[]) => {
      reorderMutation.mutate({ taskIds, date: getTodayDate() });
    },
    [reorderMutation],
  );

  if (isLoading) {
    return <DailyViewSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Failed to load agenda</p>
      </div>
    );
  }

  if (!showTodayView || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Select today to view your agenda</p>
      </div>
    );
  }

  const { tasks, events, summary } = data.data;

  // Separate tasks by status
  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-6 p-6">
      {/* Time Utilization */}
      <TimeUtilization summary={summary} />

      {/* Tasks Section */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Tasks ({pendingTasks.length})
        </h2>
        <SortableTaskList
          tasks={pendingTasks}
          onReorder={handleReorder}
          onTaskStatusChange={handleTaskStatusChange}
        />

        {/* Quick Create Task */}
        <div className="mt-3">
          <QuickCreateTask date={date} />
        </div>

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <div className="mt-4">
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">
              Completed ({completedTasks.length})
            </h3>
            <div className="space-y-2">
              {completedTasks.map((task: Task) => (
                <AgendaTaskItem
                  key={task.id}
                  task={task}
                  onStatusChange={handleTaskStatusChange}
                  showDragHandle={false}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Events Section */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Events ({events.length})
        </h2>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No events scheduled for today</p>
        ) : (
          <div className="space-y-2">
            {events.map((event: Event) => (
              <AgendaEventItem key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* Quick Create Event */}
        <div className="mt-3">
          <QuickCreateEvent date={date} />
        </div>
      </section>
    </div>
  );
}

/**
 * Loading skeleton for daily view.
 */
function DailyViewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Time Utilization Skeleton */}
      <div className="bg-card rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-2 w-full" />
      </div>

      {/* Tasks Skeleton */}
      <section>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </section>

      {/* Events Skeleton */}
      <section>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  );
}
