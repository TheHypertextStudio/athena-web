/**
 * Task row component for the Tasks surface.
 *
 * Displays a single task with status, priority, deadline, and project info.
 * Supports click navigation, context menu, and status toggle.
 *
 * Designed with Linear-like craft: subtle hover states, refined typography,
 * intentional spacing, and smooth transitions.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type TaskStatus = Task['status'];

/**
 * Priority indicator colors - subtle left border accent.
 */
const priorityColors = {
  low: 'bg-outline-variant',
  medium: 'bg-primary',
  high: 'bg-warning',
  urgent: 'bg-error',
} as const;

/**
 * Check if a deadline is overdue.
 */
function isOverdue(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  const now = new Date();
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

export interface TaskRowProps {
  /** The task to display */
  task: Task;
  /** Project name to display (optional) */
  projectName?: string;
  /** Whether to show the project name on hover */
  showProjectOnHover?: boolean;
  /** Whether to always show the project name */
  alwaysShowProject?: boolean;
  /** Callback when the task is clicked */
  onClick?: (task: Task) => void;
  /** Callback when the context menu should open */
  onContextMenu?: (task: Task, e: React.MouseEvent) => void;
  /** Callback when the status checkbox is toggled */
  onStatusToggle?: (taskId: string, newStatus: TaskStatus) => Promise<void>;
  /** Whether the row is selected */
  selected?: boolean;
  /** Callback when selection changes (prefixed with _ as intentionally unused for now) */
  _onSelect?: (taskId: string) => void;
  /** Additional class name */
  className?: string;
}

/**
 * Task row component with Linear-like design.
 */
export const TaskRow = memo(function TaskRow({
  task,
  projectName,
  showProjectOnHover = true,
  alwaysShowProject = false,
  onClick,
  onContextMenu,
  onStatusToggle,
  selected = false,
  _onSelect,
  className,
}: TaskRowProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const checkboxRef = useRef<HTMLButtonElement>(null);

  const isCompleted = task.status === 'completed';
  const isInProgress = task.status === 'in_progress';
  const overdue = isOverdue(task.deadline) && !isCompleted;

  const handleStatusToggle = useCallback(
    async (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isUpdating || !onStatusToggle) return;

      setIsUpdating(true);
      try {
        const newStatus = isCompleted ? 'pending' : 'completed';
        await onStatusToggle(task.id, newStatus);
      } finally {
        setIsUpdating(false);
      }
    },
    [isUpdating, isCompleted, task.id, onStatusToggle],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        void handleStatusToggle(e);
      }
    },
    [handleStatusToggle],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't navigate if clicking on the checkbox
      if ((e.target as HTMLElement).closest('button[data-checkbox]')) {
        return;
      }
      onClick?.(task);
    },
    [onClick, task],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu?.(task, e);
    },
    [onContextMenu, task],
  );

  const showProject = alwaysShowProject || (showProjectOnHover && isHovered && projectName);

  return (
    <motion.div
      ref={rowRef}
      layoutId={`task-${task.id}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => {
        setIsHovered(true);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClick?.(task);
        }
      }}
      layout
      transition={{
        type: 'spring',
        stiffness: 500,
        damping: 30,
        mass: 1,
      }}
      className={cn(
        // Base styles
        'group relative flex items-start gap-3 rounded-lg px-3 py-2.5',
        'cursor-pointer outline-none',
        // Hover effect
        'hover:bg-surface-container-high/50',
        // Focus effect
        'focus-visible:ring-primary/50 focus-visible:ring-2',
        // Selected state
        selected && 'bg-primary/5 ring-primary/20 ring-1',
        // Completed state
        isCompleted && 'opacity-60',
        // Transition
        'transition-colors duration-150',
        className,
      )}
    >
      {/* Priority indicator - subtle left border accent */}
      <div
        className={cn(
          'absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full',
          'transition-opacity duration-150',
          priorityColors[task.priority],
          isCompleted ? 'opacity-30' : 'opacity-100',
        )}
      />

      {/* Status Checkbox */}
      <button
        ref={checkboxRef}
        type="button"
        data-checkbox
        onClick={(e) => void handleStatusToggle(e)}
        onKeyDown={handleKeyDown}
        disabled={isUpdating}
        aria-label={isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
        className={cn(
          'mt-0.5 flex-shrink-0 rounded-full p-0.5',
          'transition-all duration-150',
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
          <CheckCircleIcon sx={{ fontSize: 18 }} />
        ) : isInProgress ? (
          <ScheduleIcon sx={{ fontSize: 18 }} />
        ) : (
          <RadioButtonUncheckedIcon sx={{ fontSize: 18 }} />
        )}
      </button>

      {/* Task Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          {/* Title */}
          <span
            className={cn(
              'flex-1 truncate text-sm font-medium',
              'transition-colors duration-150',
              isCompleted && 'text-on-surface-variant line-through',
              overdue && 'text-error',
            )}
          >
            {task.title}
          </span>

          {/* Metadata - right aligned */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Deadline */}
            {task.deadline && (
              <span
                className={cn(
                  'flex items-center gap-1 text-xs tabular-nums',
                  'transition-colors duration-150',
                  overdue ? 'text-error font-medium' : 'text-on-surface-variant',
                )}
              >
                {overdue && <ErrorOutlineIcon sx={{ fontSize: 12 }} />}
                {formatDeadline(task.deadline)}
              </span>
            )}

            {/* Priority badge - only for high/urgent */}
            {(task.priority === 'urgent' || task.priority === 'high') && !isCompleted && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                  'transition-colors duration-150',
                  task.priority === 'urgent'
                    ? 'bg-error/10 text-error'
                    : 'bg-warning/10 text-warning',
                )}
              >
                {task.priority}
              </span>
            )}
          </div>
        </div>

        {/* Project name - shown on hover or always */}
        {showProject && (
          <div
            className={cn(
              'mt-0.5 text-xs',
              'text-on-surface-variant',
              'transition-opacity duration-150',
              showProjectOnHover && !alwaysShowProject && 'opacity-0 group-hover:opacity-100',
            )}
          >
            {projectName}
          </div>
        )}
      </div>
    </motion.div>
  );
});

export default TaskRow;
