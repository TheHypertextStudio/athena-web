/**
 * Task creation modal component.
 *
 * Provides a centered modal for creating new tasks with title, description,
 * due date, priority, and project assignment. Uses shadcn Dialog.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Flag, Folder, Calendar, Sparkles, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TransitionModal } from '@/components/ui/transition-modal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type Task, type CreateTaskInput, type TimeBlock } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type TaskPriority = Task['priority'];

export interface TimeBlockOption {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  color: string | null;
}

export interface Project {
  id: string;
  name: string;
}

export interface TaskCreationModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Layout ID for shared element transitions */
  layoutId?: string;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback when task is created */
  onCreate: (input: CreateTaskInput) => Promise<Task>;
  /** Available projects */
  projects?: Project[];
  /** Default project ID */
  defaultProjectId?: string | null;
  /** Available time blocks (typically today's time blocks) */
  timeBlocks?: TimeBlock[];
  /** Callback to link task to time block after creation */
  onLinkToTimeBlock?: (taskId: string, timeBlockId: string) => Promise<void>;
}

const priorityOptions: { value: TaskPriority; label: string; color: string; bg: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'text-error', bg: 'bg-error/10' },
  { value: 'high', label: 'High', color: 'text-warning', bg: 'bg-warning/10' },
  { value: 'medium', label: 'Medium', color: 'text-primary', bg: 'bg-primary/10' },
  { value: 'low', label: 'Low', color: 'text-on-surface-variant', bg: 'bg-surface-container-high' },
];

/**
 * Centered modal for task creation.
 */
export const TaskCreationModal = memo(function TaskCreationModal({
  open,
  layoutId,
  onClose,
  onCreate,
  projects = [],
  defaultProjectId,
  timeBlocks = [],
  onLinkToTimeBlock,
}: TaskCreationModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [deadline, setDeadline] = useState<string>('');
  const [timeBlockId, setTimeBlockId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setProjectId(defaultProjectId ?? null);
      setDeadline('');
      setTimeBlockId(null);
      setIsSubmitting(false);

      // Focus input after animation
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open, defaultProjectId]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!title.trim() || isSubmitting) return;

      setIsSubmitting(true);
      try {
        const task = await onCreate({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          projectId: projectId ?? undefined,
          deadline: deadline || undefined,
        });

        // Link to time block if selected
        if (timeBlockId && onLinkToTimeBlock) {
          await onLinkToTimeBlock(task.id, timeBlockId);
        }

        onClose();
      } catch {
        // Error handling - could show toast
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      title,
      description,
      priority,
      projectId,
      deadline,
      timeBlockId,
      isSubmitting,
      onCreate,
      onLinkToTimeBlock,
      onClose,
    ],
  );

  const selectedPriority = priorityOptions.find((p) => p.value === priority);
  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedTimeBlock = timeBlocks.find((b) => b.id === timeBlockId);

  return (
    <TransitionModal open={open} onClose={onClose} layoutId={layoutId} className="max-w-xl p-0">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        {/* Header */}
        <div className="bg-primary-container/30 rounded-t-3xl px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-full">
              <Sparkles className="text-primary h-5 w-5" />
            </div>
            <h2 className="text-on-surface text-xl font-semibold">New Task</h2>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-6">
          {/* Title input */}
          <input
            ref={inputRef}
            type="text"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            className={cn(
              'bg-transparent',
              'w-full text-xl font-medium tracking-tight',
              'focus:outline-none',
              'placeholder:text-on-surface-variant/40',
            )}
          />

          {/* Description */}
          <textarea
            placeholder="Add details, notes, or context..."
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            rows={3}
            className={cn(
              'bg-surface-container-high rounded-2xl',
              'w-full px-4 py-3 text-sm leading-relaxed',
              'focus:ring-primary/20 focus:ring-2 focus:outline-none',
              'transition-all duration-200',
              'placeholder:text-on-surface-variant/50',
              'resize-none',
            )}
          />

          {/* Options - chips style */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Due date chip */}
            <button
              type="button"
              onClick={() => {
                const input = document.getElementById('task-deadline-input');
                if (input instanceof HTMLInputElement && typeof input.showPicker === 'function') {
                  input.showPicker();
                }
              }}
              className={cn(
                'bg-surface-container-high hover:bg-surface-container-highest',
                'flex items-center gap-2 rounded-full px-4 py-2',
                'transition-colors duration-200',
                'text-sm',
                deadline ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              <Calendar className="h-4 w-4" />
              <span>
                {deadline
                  ? new Date(deadline + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Due date'}
              </span>
              <input
                id="task-deadline-input"
                type="date"
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                }}
                className="sr-only"
              />
            </button>

            {/* Priority chip */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2',
                    'transition-all duration-200',
                    'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
                    selectedPriority?.bg,
                    'hover:opacity-80',
                  )}
                >
                  <Flag className={cn('h-4 w-4', selectedPriority?.color)} />
                  <span className={cn('text-sm font-medium', selectedPriority?.color)}>
                    {selectedPriority?.label}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="rounded-2xl">
                {priorityOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => {
                      setPriority(option.value);
                    }}
                    className="rounded-xl"
                  >
                    <Flag className={cn('mr-2 h-4 w-4', option.color)} />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Project chip */}
            {projects.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'bg-surface-container hover:bg-surface-container-high',
                      'flex items-center gap-2 rounded-full px-4 py-2',
                      'transition-colors duration-200',
                      'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
                    )}
                  >
                    <Folder className="text-on-surface-variant h-4 w-4" />
                    <span className="text-on-surface-variant text-sm">
                      {selectedProject?.name ?? 'No Project'}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="rounded-2xl">
                  {projects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => {
                        setProjectId(project.id);
                      }}
                      className="rounded-xl"
                    >
                      {project.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={() => {
                      setProjectId(null);
                    }}
                    className="rounded-xl"
                  >
                    No Project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Time block chip */}
            {timeBlocks.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'flex items-center gap-2 rounded-full px-4 py-2',
                      'transition-colors duration-200',
                      'focus-visible:ring-primary/50 focus:outline-none focus-visible:ring-2',
                      selectedTimeBlock
                        ? 'bg-primary/10 text-primary'
                        : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant',
                    )}
                  >
                    {selectedTimeBlock?.color ? (
                      <span
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: selectedTimeBlock.color }}
                      />
                    ) : (
                      <LayoutGrid className="h-4 w-4" />
                    )}
                    <span className="text-sm">
                      {selectedTimeBlock?.label ?? 'Add to Time Block'}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="rounded-2xl">
                  {timeBlocks.map((block) => (
                    <DropdownMenuItem
                      key={block.id}
                      onClick={() => {
                        setTimeBlockId(block.id);
                      }}
                      className="rounded-xl"
                    >
                      <span className="flex items-center gap-2">
                        {block.color ? (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: block.color }}
                          />
                        ) : (
                          <LayoutGrid className="h-3 w-3" />
                        )}
                        {block.label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={() => {
                      setTimeBlockId(null);
                    }}
                    className="rounded-xl"
                  >
                    No Time Block
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-col-reverse gap-3 px-6 pb-6 sm:flex-row sm:justify-end">
          <Button variant="text" onClick={onClose} type="button" className="rounded-full px-6">
            Cancel
          </Button>
          <Button
            variant="filled"
            type="submit"
            disabled={!title.trim() || isSubmitting}
            className="rounded-full px-8"
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </Button>
        </div>
      </form>
    </TransitionModal>
  );
});

export default TaskCreationModal;
