/**
 * Day column component for weekly view.
 *
 * @packageDocumentation
 */

'use client';

import Link from 'next/link';
import { isToday } from '@/hooks/use-agenda';
import type { Task, Event } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface DayColumnProps {
  /** Date for this column (YYYY-MM-DD) */
  date: string;
  /** Tasks for this day */
  tasks: Task[];
  /** Events for this day */
  events: Event[];
}

/**
 * Single day column in the weekly view.
 */
export function DayColumn({ date, tasks, events }: DayColumnProps) {
  const dateObj = new Date(date);
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNumber = dateObj.getDate();
  const isTodayDate = isToday(date);

  const pendingTasks = tasks.filter((t) => t.status !== 'completed');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div
      className={cn(
        'flex min-w-[140px] flex-1 flex-col border-r last:border-r-0',
        isTodayDate && 'bg-accent/30',
      )}
    >
      {/* Day Header */}
      <Link href={`/home?date=${date}`} className="block">
        <div
          className={cn(
            'bg-background hover:bg-accent/50 sticky top-0 z-10 border-b px-3 py-2 text-center transition-colors',
            isTodayDate && 'bg-accent',
          )}
        >
          <div className="text-muted-foreground text-xs font-medium uppercase">{dayName}</div>
          <div className={cn('text-lg font-semibold', isTodayDate && 'text-primary')}>
            {dayNumber}
          </div>
        </div>
      </Link>

      {/* Day Content */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {/* Events */}
        {events.map((event) => (
          <EventChip key={event.id} event={event} />
        ))}

        {/* Tasks */}
        {pendingTasks.map((task) => (
          <TaskChip key={task.id} task={task} />
        ))}

        {/* Completed Tasks (dimmed) */}
        {completedTasks.map((task) => (
          <TaskChip key={task.id} task={task} completed />
        ))}

        {/* Empty State */}
        {events.length === 0 && tasks.length === 0 && (
          <div className="text-muted-foreground py-4 text-center text-xs">No items</div>
        )}
      </div>
    </div>
  );
}

interface EventChipProps {
  event: Event;
}

function EventChip({ event }: EventChipProps) {
  const startTime = event.isAllDay
    ? 'All day'
    : new Date(event.startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });

  return (
    <div className="rounded bg-blue-100 px-2 py-1 text-xs dark:bg-blue-900/30">
      <div className="truncate font-medium">{event.title}</div>
      <div className="text-muted-foreground">{startTime}</div>
    </div>
  );
}

interface TaskChipProps {
  task: Task;
  completed?: boolean;
}

function TaskChip({ task, completed }: TaskChipProps) {
  const priorityColors: Record<Task['priority'], string> = {
    urgent: 'border-l-red-500',
    high: 'border-l-orange-500',
    medium: 'border-l-yellow-500',
    low: 'border-l-green-500',
  };

  return (
    <div
      className={cn(
        'bg-card rounded border border-l-4 px-2 py-1 text-xs',
        priorityColors[task.priority],
        completed && 'line-through opacity-50',
      )}
    >
      <div className="truncate">{task.title}</div>
      {task.estimatedMinutes && (
        <div className="text-muted-foreground">{task.estimatedMinutes}min</div>
      )}
    </div>
  );
}
