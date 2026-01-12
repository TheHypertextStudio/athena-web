/**
 * Task detail modal component.
 *
 * Displays full task information in a modal overlay, following
 * the route interception pattern for seamless navigation.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  Calendar,
  X,
  Maximize2,
  Edit,
  Trash2,
  FolderKanban,
  GitBranch,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi, type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const statusConfig = {
  pending: { icon: Circle, label: 'Pending', color: 'text-on-surface-variant' },
  in_progress: { icon: Clock, label: 'In Progress', color: 'text-tertiary' },
  completed: { icon: CheckCircle2, label: 'Completed', color: 'text-primary' },
  cancelled: { icon: AlertCircle, label: 'Cancelled', color: 'text-error' },
} as const;

const priorityConfig = {
  low: { label: 'Low', color: 'bg-slate-400', textColor: 'text-slate-600 dark:text-slate-400' },
  medium: { label: 'Medium', color: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400' },
  high: {
    label: 'High',
    color: 'bg-orange-500',
    textColor: 'text-orange-600 dark:text-orange-400',
  },
  urgent: { label: 'Urgent', color: 'bg-red-500', textColor: 'text-error' },
} as const;

/**
 * Format a deadline for display.
 */
function formatDeadline(deadline: string): string {
  const date = new Date(deadline);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Check if a deadline is overdue.
 */
function isOverdue(deadline: string): boolean {
  const deadlineDate = new Date(deadline);
  const now = new Date();
  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return deadlineDate < now;
}

/**
 * Format estimated time.
 */
function formatEstimate(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${String(hours)}h ${String(mins)}m` : `${String(hours)}h`;
  }
  return `${String(minutes)}m`;
}

export interface TaskDetailModalProps {
  /** The task to display */
  task: Task | null;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string | null;
  /** Close handler */
  onClose: () => void;
  /** Expand to full page handler */
  onExpand?: () => void;
  /** Called after task is deleted */
  onDeleted?: () => void;
  /** Called after task status changes */
  onStatusChange?: (task: Task) => void;
}

/**
 * Task detail modal content.
 *
 * Designed with Linear-like craft: clean typography, subtle interactions,
 * and focused information hierarchy.
 */
export function TaskDetailModal({
  task,
  isLoading,
  error,
  onClose,
  onExpand,
  onDeleted,
  onStatusChange,
}: TaskDetailModalProps) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleStatusChange = useCallback(
    async (newStatus: Task['status']) => {
      if (!task || isUpdating) return;

      setIsUpdating(true);
      try {
        const response = await tasksApi.update(task.id, { status: newStatus });
        void queryClient.invalidateQueries({ queryKey: ['tasks'] });
        onStatusChange?.(response.data);
      } catch {
        // Could show error toast
      } finally {
        setIsUpdating(false);
      }
    },
    [task, isUpdating, queryClient, onStatusChange],
  );

  const handleDelete = useCallback(async () => {
    if (!task || isDeleting) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    setIsDeleting(true);
    try {
      await tasksApi.delete(task.id);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onDeleted?.();
      onClose();
    } catch {
      // Could show error toast
      setIsDeleting(false);
    }
  }, [task, isDeleting, queryClient, onDeleted, onClose]);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-surface border-outline-variant overflow-hidden rounded-xl border shadow-xl">
        <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
          <Skeleton className="h-5 w-32" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </div>
        </div>
        <div className="space-y-4 p-6">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex gap-2 pt-4">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-surface border-outline-variant overflow-hidden rounded-xl border shadow-xl">
        <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
          <span className="text-on-surface text-sm font-medium">Task Details</span>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface rounded p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex items-center justify-center p-12">
          <p className="text-error">{error}</p>
        </div>
      </div>
    );
  }

  // No task state
  if (!task) {
    return null;
  }

  const StatusIcon = statusConfig[task.status].icon;
  const overdue = task.deadline && isOverdue(task.deadline) && task.status !== 'completed';

  return (
    <div className="bg-surface border-outline-variant overflow-hidden rounded-xl border shadow-xl">
      {/* Header */}
      <div className="border-outline-variant flex items-center justify-between border-b px-4 py-3">
        <span className="text-on-surface-variant text-sm font-medium">Task Details</span>
        <div className="flex items-center gap-1">
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="text-on-surface-variant hover:text-on-surface rounded p-1.5 transition-colors"
              title="Expand to full page"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface rounded p-1.5 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[70vh] overflow-y-auto p-6">
        {/* Title and metadata */}
        <div className="mb-6">
          <div className="mb-3 flex items-start gap-3">
            <StatusIcon
              className={cn('mt-1 h-5 w-5 flex-shrink-0', statusConfig[task.status].color)}
            />
            <h2
              className={cn(
                'text-xl font-semibold',
                task.status === 'completed' && 'line-through opacity-60',
              )}
            >
              {task.title}
            </h2>
          </div>

          {/* Status line */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={cn('capitalize', statusConfig[task.status].color)}>
              {statusConfig[task.status].label}
            </span>
            <span className="text-on-surface-variant/40">·</span>
            <span className={cn('font-medium capitalize', priorityConfig[task.priority].textColor)}>
              {priorityConfig[task.priority].label} priority
            </span>
            {task.deadline && (
              <>
                <span className="text-on-surface-variant/40">·</span>
                <span
                  className={cn(
                    'flex items-center gap-1',
                    overdue ? 'text-error font-medium' : 'text-on-surface-variant',
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {overdue && <AlertCircle className="h-3.5 w-3.5" />}
                  {formatDeadline(task.deadline)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <div className="mb-6">
            <h3 className="text-on-surface-variant mb-2 text-xs font-semibold tracking-wide uppercase">
              Description
            </h3>
            <p className="text-on-surface text-sm leading-relaxed whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        )}

        {/* Metadata grid */}
        <div className="border-outline-variant mb-6 grid gap-4 border-t pt-4 sm:grid-cols-2">
          {task.estimatedMinutes && (
            <div>
              <h3 className="text-on-surface-variant mb-1 text-xs font-semibold tracking-wide uppercase">
                Estimate
              </h3>
              <span className="text-on-surface flex items-center gap-1.5 text-sm">
                <Clock className="text-on-surface-variant h-4 w-4" />
                {formatEstimate(task.estimatedMinutes)}
              </span>
            </div>
          )}
          {task.projectId && (
            <div>
              <h3 className="text-on-surface-variant mb-1 text-xs font-semibold tracking-wide uppercase">
                Project
              </h3>
              <Link
                href={`/projects/${task.projectId}`}
                className="text-primary hover:text-primary/80 flex items-center gap-1.5 text-sm transition-colors"
              >
                <FolderKanban className="h-4 w-4" />
                View Project
              </Link>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="border-outline-variant mb-6 border-t pt-4">
          <h3 className="text-on-surface-variant mb-3 text-xs font-semibold tracking-wide uppercase">
            Quick Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            {task.status !== 'in_progress' && task.status !== 'completed' && (
              <Button
                variant="outlined"
                size="sm"
                onClick={() => void handleStatusChange('in_progress')}
                disabled={isUpdating}
              >
                <Clock className="mr-1.5 h-4 w-4" />
                Start Working
              </Button>
            )}
            {task.status !== 'completed' && (
              <Button
                variant="outlined"
                size="sm"
                onClick={() => void handleStatusChange('completed')}
                disabled={isUpdating}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Mark Complete
              </Button>
            )}
            {task.status === 'completed' && (
              <Button
                variant="outlined"
                size="sm"
                onClick={() => void handleStatusChange('pending')}
                disabled={isUpdating}
              >
                <Circle className="mr-1.5 h-4 w-4" />
                Reopen
              </Button>
            )}
          </div>
        </div>

        {/* Dependencies link */}
        <div className="border-outline-variant border-t pt-4">
          <Link
            href={`/tasks/${task.id}/dependencies`}
            className="text-on-surface-variant hover:text-on-surface flex items-center gap-2 text-sm transition-colors"
          >
            <GitBranch className="h-4 w-4" />
            View Dependencies
          </Link>
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-outline-variant flex items-center justify-between border-t px-4 py-3">
        <Button variant="text" size="sm" asChild>
          <Link href={`/tasks/${task.id}/edit`}>
            <Edit className="mr-1.5 h-4 w-4" />
            Edit
          </Link>
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={() => void handleDelete()}
          disabled={isDeleting}
          className="text-error hover:text-error hover:bg-error/10"
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  );
}
