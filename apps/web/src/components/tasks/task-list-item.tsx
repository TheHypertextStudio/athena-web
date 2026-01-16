/**
 * Unified task item component for list and agenda views.
 *
 * Designed with Linear-like craft: subtle hover states, refined typography,
 * intentional spacing, and smooth transitions.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import DragIndicator from '@mui/icons-material/DragIndicator';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import GpsFixedOutlined from '@mui/icons-material/GpsFixedOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import { tasksApi, type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Initiative context for ambient awareness.
 */
export interface TaskInitiativeContext {
  /** Initiative ID */
  initiativeId?: string;
  /** Initiative name */
  initiativeName?: string;
  /** Project name */
  projectName?: string;
}

/**
 * Priority indicator colors - subtle, not badges.
 */
const priorityIndicatorColors = {
  low: 'bg-slate-400',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
} as const;

/**
 * Check if a deadline is overdue.
 */
function isOverdue(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  const now = new Date();
  // Set to start of day for comparison
  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return deadlineDate < now;
}

/**
 * Format a deadline for display - concise and contextual.
 */
function formatDeadline(deadline: string): string {
  const date = new Date(deadline);
  const now = new Date();

  // Reset to start of day for comparison
  const deadlineDay = new Date(date);
  const today = new Date(now);
  deadlineDay.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((deadlineDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDiff = Math.abs(diffDays);
    return absDiff === 1 ? 'Yesterday' : `${String(absDiff)}d ago`;
  }
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Tomorrow';
  }
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface TaskListItemProps {
  /** The task to display */
  task: Task;
  /** Display variant - affects which metadata is shown */
  variant?: 'list' | 'agenda';
  /** Whether to show the drag handle (agenda only) */
  showDragHandle?: boolean;
  /** Callback when task status changes */
  onStatusChange?: (taskId: string, completed: boolean) => void;
  /** Props from dnd-kit for dragging */
  dragHandleProps?: Record<string, unknown>;
  /** Whether this item is being dragged */
  isDragging?: boolean;
  /** Initiative/project context for ambient awareness */
  context?: TaskInitiativeContext;
  /** Whether to show initiative context (defaults to false, can be 'hover' or 'always') */
  showContext?: false | 'hover' | 'always';
  /** Custom class name */
  className?: string;
}

/**
 * Unified task item component.
 *
 * Used in both the task list view and agenda view with slight variations.
 * Designed for Linear-like craft and feel.
 *
 * @example
 * ```tsx
 * // In task list
 * <TaskListItem task={task} variant="list" onStatusChange={handleChange} />
 *
 * // In agenda
 * <TaskListItem task={task} variant="agenda" showDragHandle dragHandleProps={...} />
 * ```
 */
export function TaskListItem({
  task,
  variant = 'list',
  showDragHandle = false,
  onStatusChange,
  dragHandleProps,
  isDragging,
  context,
  showContext = false,
  className,
}: TaskListItemProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const checkboxRef = useRef<HTMLButtonElement>(null);

  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const overdue = isOverdue(task.deadline) && !isCompleted;

  const handleToggleComplete = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isUpdating) return;

      setIsUpdating(true);
      try {
        const newStatus = isCompleted ? 'pending' : 'completed';
        await tasksApi.update(task.id, { status: newStatus });
        onStatusChange?.(task.id, newStatus === 'completed');
      } catch {
        // Error handling - could show toast
      } finally {
        setIsUpdating(false);
      }
    },
    [isUpdating, isCompleted, task.id, onStatusChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        void handleToggleComplete(e);
      }
    },
    [handleToggleComplete],
  );

  return (
    <div
      className={cn(
        // Base styles - clean, minimal
        'group relative flex items-center gap-3 rounded-lg px-3 py-2.5',
        // Subtle hover effect - Linear-like
        'hover:bg-surface-container-high/50 transition-colors duration-150',
        // Drag state
        isDragging && 'bg-surface-container opacity-90 shadow-lg',
        // Completed state - subtle fade
        isCompleted && 'opacity-50',
        className,
      )}
    >
      {/* Priority indicator - subtle left border accent */}
      <div
        className={cn(
          'absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity',
          priorityIndicatorColors[task.priority],
          isCompleted ? 'opacity-30' : 'opacity-100',
        )}
      />

      {/* Drag Handle (agenda only) - appears on hover */}
      {showDragHandle && variant === 'agenda' && (
        <button
          type="button"
          className={cn(
            'text-on-surface-variant hover:text-on-surface -ml-1 cursor-grab touch-none',
            'opacity-0 transition-opacity duration-150 group-hover:opacity-100',
            'focus:opacity-100 focus:outline-none',
          )}
          tabIndex={-1}
          {...dragHandleProps}
        >
          <DragIndicator sx={{ fontSize: 16 }} />
        </button>
      )}

      {/* Status Checkbox - refined interaction */}
      <button
        ref={checkboxRef}
        type="button"
        onClick={(e) => void handleToggleComplete(e)}
        onKeyDown={handleKeyDown}
        disabled={isUpdating}
        aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
        className={cn(
          'flex-shrink-0 rounded-full p-0.5 transition-all duration-150',
          'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
          isUpdating && 'animate-pulse',
          isCompleted
            ? 'text-primary'
            : isInProgress
              ? 'text-tertiary'
              : 'text-on-surface-variant hover:text-on-surface',
        )}
      >
        {isCompleted ? (
          <CheckCircleOutlined sx={{ fontSize: 18 }} />
        ) : isInProgress ? (
          <ScheduleOutlined sx={{ fontSize: 18 }} />
        ) : (
          <RadioButtonUncheckedOutlined sx={{ fontSize: 18 }} />
        )}
      </button>

      {/* Task Content - Links to task detail */}
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-0.5',
          'focus-visible:ring-primary/50 focus:outline-none focus-visible:rounded focus-visible:ring-2',
        )}
      >
        <div className="flex items-center gap-3">
          {/* Title */}
          <span
            className={cn(
              'flex-1 truncate text-sm font-medium',
              isCompleted && 'text-on-surface-variant line-through',
              overdue && 'text-error',
            )}
          >
            {task.title}
          </span>

          {/* Metadata - contextual based on variant */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Estimated time (agenda) */}
            {variant === 'agenda' && task.estimatedMinutes && (
              <span className="text-on-surface-variant flex items-center gap-1 text-xs tabular-nums">
                {task.estimatedMinutes}m
              </span>
            )}

            {/* Deadline (list) */}
            {variant === 'list' && task.deadline && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs',
                  overdue ? 'text-error font-medium' : 'text-on-surface-variant',
                )}
              >
                {overdue && <ErrorOutlineOutlined sx={{ fontSize: 12 }} />}
                {formatDeadline(task.deadline)}
              </span>
            )}

            {/* Priority label - minimal, only for high/urgent */}
            {(task.priority === 'urgent' || task.priority === 'high') && !isCompleted && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                  task.priority === 'urgent'
                    ? 'bg-error/10 text-error'
                    : 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
                )}
              >
                {task.priority}
              </span>
            )}
          </div>
        </div>

        {/* Initiative context breadcrumb - ambient awareness */}
        {showContext && context && (context.initiativeName ?? context.projectName) && (
          <div
            className={cn(
              'text-on-surface-variant/70 flex items-center gap-1 text-[11px]',
              showContext === 'hover' && 'opacity-0 transition-opacity group-hover:opacity-100',
            )}
          >
            {context.initiativeName && (
              <>
                <GpsFixedOutlined sx={{ fontSize: 12 }} />
                <span className="truncate">{context.initiativeName}</span>
              </>
            )}
            {context.initiativeName && context.projectName && (
              <ChevronRightOutlined sx={{ fontSize: 12 }} className="flex-shrink-0" />
            )}
            {context.projectName && <span className="truncate">{context.projectName}</span>}
          </div>
        )}
      </Link>
    </div>
  );
}
