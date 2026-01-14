/**
 * Intercepted task detail modal.
 *
 * Shows when navigating from the task list to a task detail.
 * The URL changes but the list stays visible underneath.
 * Uses Framer Motion layoutId for shared element transitions.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import FlagIcon from '@mui/icons-material/Flag';
import FolderIcon from '@mui/icons-material/Folder';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import { TransitionModal } from '@/components/ui/transition-modal';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksApi, type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const priorityConfig = {
  urgent: { label: 'Urgent', color: 'text-error', bg: 'bg-error/10' },
  high: { label: 'High', color: 'text-warning', bg: 'bg-warning/10' },
  medium: { label: 'Medium', color: 'text-primary', bg: 'bg-primary/10' },
  low: { label: 'Low', color: 'text-on-surface-variant', bg: 'bg-surface-container-high' },
} as const;

const statusConfig = {
  pending: { label: 'Pending', Icon: RadioButtonUncheckedIcon },
  in_progress: { label: 'In Progress', Icon: ScheduleIcon },
  completed: { label: 'Completed', Icon: CheckCircleIcon },
  cancelled: { label: 'Cancelled', Icon: RadioButtonUncheckedIcon },
} as const;

export default function TaskDetailModal() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    async function fetchTask() {
      try {
        const response = await tasksApi.get(taskId);
        setTask(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task');
      } finally {
        setIsLoading(false);
      }
    }
    void fetchTask();
  }, [taskId]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleOpenFullPage = useCallback(() => {
    // Navigate to full page without interception
    window.location.href = `/tasks/${taskId}`;
  }, [taskId]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    setIsDeleting(true);
    try {
      await tasksApi.delete(taskId);
      router.back();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task');
      setIsDeleting(false);
    }
  }, [taskId, router]);

  const handleStatusChange = useCallback(
    async (newStatus: Task['status']) => {
      if (!task) return;

      try {
        const response = await tasksApi.update(taskId, { status: newStatus });
        setTask(response.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update status');
      }
    },
    [task, taskId],
  );

  const priority = task ? priorityConfig[task.priority] : null;
  const status = task ? statusConfig[task.status] : null;
  const StatusIcon = status?.Icon ?? RadioButtonUncheckedIcon;

  return (
    <TransitionModal open onClose={handleClose} layoutId={`task-${taskId}`} className="max-w-2xl">
      {isLoading ? (
        <div className="space-y-4 p-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="p-6">
          <p className="text-error text-center">{error}</p>
          <Button variant="text" onClick={handleClose} className="mx-auto mt-4 block">
            Close
          </Button>
        </div>
      ) : task ? (
        <>
          {/* Header */}
          <div className="bg-surface-container rounded-t-3xl px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleStatusChange(
                        task.status === 'completed' ? 'pending' : 'completed',
                      );
                    }}
                    className={cn(
                      'flex-shrink-0 transition-all duration-200',
                      task.status === 'completed' ? 'text-primary' : 'text-on-surface-variant',
                    )}
                  >
                    <StatusIcon sx={{ fontSize: 24 }} />
                  </button>
                  <h2
                    className={cn(
                      'text-on-surface text-xl font-semibold',
                      task.status === 'completed' && 'line-through opacity-60',
                    )}
                  >
                    {task.title}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Status chip */}
                  <span
                    className={cn(
                      'bg-surface-container-high rounded-full px-3 py-1 text-xs font-medium',
                      'text-on-surface-variant',
                    )}
                  >
                    {status?.label}
                  </span>
                  {/* Priority chip */}
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium',
                      priority?.bg,
                      priority?.color,
                    )}
                  >
                    <FlagIcon sx={{ fontSize: 12 }} />
                    {priority?.label}
                  </span>
                  {/* Deadline */}
                  {task.deadline && (
                    <span className="text-on-surface-variant flex items-center gap-1 text-xs">
                      <CalendarTodayIcon sx={{ fontSize: 12 }} />
                      {new Date(task.deadline).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleOpenFullPage}
                  className={cn(
                    'text-on-surface-variant hover:text-on-surface',
                    'hover:bg-surface-container-high rounded-full p-2 transition-colors',
                  )}
                  title="Open in full page"
                >
                  <OpenInNewIcon sx={{ fontSize: 20 }} />
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className={cn(
                    'text-on-surface-variant hover:text-on-surface',
                    'hover:bg-surface-container-high rounded-full p-2 transition-colors',
                  )}
                  title="Close"
                >
                  <CloseIcon sx={{ fontSize: 20 }} />
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
            {task.description ? (
              <div className="mb-6">
                <h3 className="text-on-surface-variant mb-2 text-xs font-medium tracking-wide uppercase">
                  Description
                </h3>
                <p className="text-on-surface leading-relaxed whitespace-pre-wrap">
                  {task.description}
                </p>
              </div>
            ) : (
              <p className="text-on-surface-variant/50 mb-6 italic">No description</p>
            )}

            {/* Details grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {task.deadline && (
                <div className="bg-surface-container rounded-2xl p-4">
                  <h3 className="text-on-surface-variant mb-1 text-xs font-medium tracking-wide uppercase">
                    Deadline
                  </h3>
                  <p className="text-on-surface flex items-center gap-2">
                    <CalendarTodayIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
                    {new Date(task.deadline).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              )}
              {task.estimatedMinutes && (
                <div className="bg-surface-container rounded-2xl p-4">
                  <h3 className="text-on-surface-variant mb-1 text-xs font-medium tracking-wide uppercase">
                    Estimated Time
                  </h3>
                  <p className="text-on-surface flex items-center gap-2">
                    <ScheduleIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
                    {task.estimatedMinutes >= 60
                      ? `${String(Math.floor(task.estimatedMinutes / 60))}h ${String(task.estimatedMinutes % 60)}m`
                      : `${String(task.estimatedMinutes)}m`}
                  </p>
                </div>
              )}
              {task.projectId && (
                <div className="bg-surface-container rounded-2xl p-4">
                  <h3 className="text-on-surface-variant mb-1 text-xs font-medium tracking-wide uppercase">
                    Project
                  </h3>
                  <p className="text-on-surface flex items-center gap-2">
                    <FolderIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
                    {task.projectId}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-surface-container rounded-b-3xl px-6 py-4">
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                {task.status !== 'in_progress' && task.status !== 'completed' && (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => {
                      void handleStatusChange('in_progress');
                    }}
                    className="rounded-full"
                  >
                    <ScheduleIcon sx={{ fontSize: 16 }} className="mr-1.5" />
                    Start Working
                  </Button>
                )}
                {task.status !== 'completed' && (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => {
                      void handleStatusChange('completed');
                    }}
                    className="rounded-full"
                  >
                    <CheckCircleIcon sx={{ fontSize: 16 }} className="mr-1.5" />
                    Complete
                  </Button>
                )}
                {task.status === 'completed' && (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => {
                      void handleStatusChange('pending');
                    }}
                    className="rounded-full"
                  >
                    <RadioButtonUncheckedIcon sx={{ fontSize: 16 }} className="mr-1.5" />
                    Reopen
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="text" size="sm" asChild className="rounded-full">
                  <a href={`/tasks/${taskId}/edit`}>
                    <EditIcon sx={{ fontSize: 16 }} className="mr-1.5" />
                    Edit
                  </a>
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isDeleting}
                  className="text-error hover:bg-error/10 rounded-full"
                >
                  <DeleteIcon sx={{ fontSize: 16 }} className="mr-1.5" />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </TransitionModal>
  );
}
