/**
 * Intercepted modal route for task details.
 *
 * When navigating to /tasks/[id] from within the app (soft navigation),
 * this intercepted route is rendered as a modal overlay instead of
 * navigating to the full page.
 *
 * Features:
 * - Modal overlay with backdrop
 * - Close returns to previous route
 * - Expand navigates to full page (/tasks/[id])
 * - Quick actions without leaving context
 *
 * @packageDocumentation
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cn } from '@/lib/utils';
import { TaskDetailModal } from '@/components/tasks/task-detail-modal';
import { tasksApi, type Task } from '@/lib/api-client';

/**
 * Task detail modal page (intercepted route).
 */
export default function TaskModalPage() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleExpand = useCallback(() => {
    // Navigate to full page (not intercepted)
    router.push(`/tasks/${taskId}`);
  }, [router, taskId]);

  const handleStatusChange = useCallback((updatedTask: Task) => {
    setTask(updatedTask);
  }, []);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed top-[10%] left-1/2 z-50 w-full max-w-lg -translate-x-1/2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-200 outline-none',
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <VisuallyHidden asChild>
            <Dialog.Title>{task?.title ?? 'Task Details'}</Dialog.Title>
          </VisuallyHidden>
          <VisuallyHidden asChild>
            <Dialog.Description>
              View and manage task details, status, and quick actions.
            </Dialog.Description>
          </VisuallyHidden>

          <TaskDetailModal
            task={task}
            isLoading={isLoading}
            error={error}
            onClose={handleClose}
            onExpand={handleExpand}
            onStatusChange={handleStatusChange}
            onDeleted={handleClose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
