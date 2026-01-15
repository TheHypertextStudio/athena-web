'use client';

import type { MouseEvent } from 'react';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { cn } from '@/lib/utils';
import type { CalendarEntry, LinkedTask } from './types';

const PRIORITY_COLORS: Record<NonNullable<LinkedTask['priority']>, string> = {
  urgent: 'bg-error',
  high: 'bg-warning',
  medium: 'bg-primary',
  low: 'bg-outline-variant',
};

function PriorityDot({ priority }: { priority?: LinkedTask['priority'] }) {
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PRIORITY_COLORS[priority ?? 'medium'])}
    />
  );
}

function TimeBlockTask({
  task,
  onClick,
  useDarkText,
}: {
  task: LinkedTask;
  onClick?: (e: MouseEvent) => void;
  useDarkText: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 py-0.5 text-left"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <PriorityDot priority={task.priority} />
      <span
        className={cn('flex-1 truncate text-xs', useDarkText ? 'text-gray-800' : 'text-white/90')}
      >
        {task.title}
      </span>
      {task.estimateMinutes && (
        <span
          className={cn('shrink-0 text-[10px]', useDarkText ? 'text-gray-600' : 'text-white/60')}
        >
          {task.estimateMinutes}m
        </span>
      )}
    </button>
  );
}

export function EntryPreview({
  startTime,
  endTime,
  formatTime,
}: {
  startTime: Date;
  endTime: Date;
  formatTime: (time: Date) => string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-2 py-1">
      <p className="text-primary truncate text-sm font-medium">
        {formatTime(startTime)} - {formatTime(endTime)}
      </p>
    </div>
  );
}

export function EntryHeader({
  entry,
  hasTasks,
  isTimeBlock,
  showDetails,
  useDarkText,
  startTime,
  endTime,
  formatTime,
}: {
  entry: CalendarEntry;
  hasTasks: boolean;
  isTimeBlock: boolean;
  showDetails: boolean;
  useDarkText: boolean;
  startTime: Date;
  endTime: Date;
  formatTime: (time: Date) => string;
}) {
  const showTime = !hasTasks && showDetails;
  const showLocation = !isTimeBlock && Boolean(entry.location) && showDetails;

  return (
    <div className="flex items-start gap-1.5 px-2 py-1">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            useDarkText ? 'text-gray-900' : 'text-white',
          )}
        >
          {entry.title}
        </p>
        {showTime && (
          <p className={cn('truncate text-xs', useDarkText ? 'text-gray-700' : 'text-white/80')}>
            {formatTime(startTime)} - {formatTime(endTime)}
          </p>
        )}
        {showLocation && (
          <p
            className={cn(
              'flex items-center gap-1 truncate text-xs',
              useDarkText ? 'text-gray-700' : 'text-white/80',
            )}
          >
            <PlaceOutlinedIcon sx={{ fontSize: 12 }} />
            {entry.location}
          </p>
        )}
      </div>
    </div>
  );
}

export function EntryTasks({
  tasks,
  maxVisibleTasks,
  useDarkText,
  onTaskClick,
}: {
  tasks: LinkedTask[];
  maxVisibleTasks: number;
  useDarkText: boolean;
  onTaskClick?: (task: LinkedTask, e: MouseEvent) => void;
}) {
  const visibleTasks = tasks.slice(0, maxVisibleTasks);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  return (
    <div className="space-y-0.5 px-2 pb-1">
      {visibleTasks.map((task) => (
        <TimeBlockTask
          key={task.id}
          task={task}
          onClick={(e) => onTaskClick?.(task, e)}
          useDarkText={useDarkText}
        />
      ))}
      {hiddenTaskCount > 0 && (
        <p className={cn('pl-4 text-[10px]', useDarkText ? 'text-gray-500' : 'text-white/50')}>
          +{hiddenTaskCount} more
        </p>
      )}
    </div>
  );
}
