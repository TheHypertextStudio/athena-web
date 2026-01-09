/**
 * Individual task item in the agenda.
 *
 * @packageDocumentation
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Clock, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { tasksApi, type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const priorityColors = {
  low: 'bg-slate-500',
  medium: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
} as const;

interface AgendaTaskItemProps {
  /** The task to display */
  task: Task;
  /** Whether to show the drag handle */
  showDragHandle?: boolean;
  /** Callback when task status changes */
  onStatusChange?: (taskId: string, completed: boolean) => void;
  /** Props from dnd-kit for dragging */
  dragHandleProps?: Record<string, unknown>;
  /** Whether this item is being dragged */
  isDragging?: boolean;
}

/**
 * Task item component for the agenda view.
 */
export function AgendaTaskItem({
  task,
  showDragHandle = true,
  onStatusChange,
  dragHandleProps,
  isDragging,
}: AgendaTaskItemProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const isCompleted = task.status === 'completed';

  async function handleToggleComplete(e: React.MouseEvent) {
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
  }

  return (
    <div
      className={cn(
        'bg-card group flex items-center gap-3 rounded-lg border p-3 transition-colors',
        isDragging && 'opacity-90 shadow-lg',
        isCompleted && 'opacity-60',
      )}
    >
      {/* Drag Handle */}
      {showDragHandle && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground cursor-grab opacity-0 transition-opacity group-hover:opacity-100"
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      {/* Checkbox */}
      <button
        type="button"
        onClick={(e) => void handleToggleComplete(e)}
        disabled={isUpdating}
        className={cn(
          'flex-shrink-0 transition-colors',
          isCompleted ? 'text-green-500' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
      </button>

      {/* Task Content */}
      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn('flex-1 truncate text-sm', isCompleted && 'line-through')}>
          {task.title}
        </span>

        {/* Estimated Time */}
        {task.estimatedMinutes && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {task.estimatedMinutes}m
          </span>
        )}

        {/* Priority Badge */}
        <Badge variant="secondary" className={cn('text-white', priorityColors[task.priority])}>
          {task.priority}
        </Badge>
      </Link>
    </div>
  );
}
