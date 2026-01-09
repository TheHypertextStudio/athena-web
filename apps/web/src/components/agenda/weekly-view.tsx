/**
 * Weekly agenda view component.
 *
 * @packageDocumentation
 */

'use client';

import { useWeeklyAgenda } from '@/hooks/use-agenda';
import { DayColumn } from './day-column';
import { Skeleton } from '@/components/ui/skeleton';

interface WeeklyViewProps {
  /** The start date of the week to display (YYYY-MM-DD) */
  startDate: string;
}

/**
 * Weekly view showing all days in a week side by side.
 */
export function WeeklyView({ startDate }: WeeklyViewProps) {
  const { data, isLoading, error } = useWeeklyAgenda(startDate);

  if (isLoading) {
    return <WeeklyViewSkeleton />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">Failed to load weekly agenda</p>
      </div>
    );
  }

  if (!data?.data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground">No data available</p>
      </div>
    );
  }

  const { days, summary } = data.data;

  // Generate array of 7 days starting from startDate
  const weekDays = getWeekDays(startDate);

  return (
    <div className="flex h-full flex-col">
      {/* Summary Bar */}
      <div className="bg-muted/30 flex items-center gap-6 border-b px-6 py-2">
        <div className="text-sm">
          <span className="font-medium">{summary.totalTasks}</span>{' '}
          <span className="text-muted-foreground">tasks</span>
        </div>
        <div className="text-sm">
          <span className="font-medium">{summary.totalEvents}</span>{' '}
          <span className="text-muted-foreground">events</span>
        </div>
      </div>

      {/* Day Columns */}
      <div className="flex flex-1 overflow-x-auto">
        {weekDays.map((date) => {
          const dayData = days[date] ?? { tasks: [], events: [] };
          return <DayColumn key={date} date={date} tasks={dayData.tasks} events={dayData.events} />;
        })}
      </div>
    </div>
  );
}

/**
 * Generate array of date strings for a week.
 */
function getWeekDays(startDate: string): string[] {
  const days: string[] = [];
  const start = new Date(startDate);

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  return days;
}

/**
 * Loading skeleton for weekly view.
 */
function WeeklyViewSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Summary Bar Skeleton */}
      <div className="bg-muted/30 flex items-center gap-6 border-b px-6 py-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Day Columns Skeleton */}
      <div className="flex flex-1 overflow-x-auto">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex min-w-[140px] flex-1 flex-col border-r last:border-r-0">
            {/* Day Header */}
            <div className="border-b px-3 py-2 text-center">
              <Skeleton className="mx-auto mb-1 h-3 w-8" />
              <Skeleton className="mx-auto h-5 w-6" />
            </div>
            {/* Day Content */}
            <div className="flex-1 space-y-2 p-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
