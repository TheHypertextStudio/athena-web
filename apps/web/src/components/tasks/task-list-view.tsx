/**
 * Task list view with smart section-based organization.
 *
 * Organizes tasks into Focus, Up Next, Later, and Completed sections
 * based on status, deadline, and recency.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Filter, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskListItem } from './task-list-item';
import { QuickCreateTask } from '@/components/agenda/quick-create';
import { tasksApi, type Task } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type TaskPriority = Task['priority'];

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
 * Check if a deadline is within the next N days.
 */
function isWithinDays(deadline: string | null | undefined, days: number): boolean {
  if (!deadline) return false;
  const deadlineDate = new Date(deadline);
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + days);

  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  future.setHours(0, 0, 0, 0);

  return deadlineDate >= now && deadlineDate <= future;
}

/**
 * Check if a task was completed today.
 */
function isCompletedToday(task: Task): boolean {
  if (task.status !== 'completed') return false;
  const updated = new Date(task.updatedAt);
  const today = new Date();
  return (
    updated.getDate() === today.getDate() &&
    updated.getMonth() === today.getMonth() &&
    updated.getFullYear() === today.getFullYear()
  );
}

interface TaskSection {
  id: string;
  title: string;
  tasks: Task[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * Organize tasks into smart sections.
 */
function organizeTasks(tasks: Task[]): TaskSection[] {
  const sections: TaskSection[] = [];

  // Focus: In-progress + overdue pending tasks
  const focusTasks = tasks.filter(
    (t) => t.status === 'in_progress' || (t.status === 'pending' && isOverdue(t.deadline)),
  );
  if (focusTasks.length > 0) {
    sections.push({
      id: 'focus',
      title: 'Focus',
      tasks: focusTasks.sort((a, b) => {
        // In-progress first, then by deadline
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        return 0;
      }),
    });
  }

  // Up Next: Pending tasks due within 7 days (not overdue)
  const upNextTasks = tasks.filter(
    (t) => t.status === 'pending' && !isOverdue(t.deadline) && isWithinDays(t.deadline, 7),
  );
  if (upNextTasks.length > 0) {
    sections.push({
      id: 'up-next',
      title: 'Up Next',
      tasks: upNextTasks.sort((a, b) => {
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        return 0;
      }),
    });
  }

  // Later: Pending tasks with no deadline or deadline > 7 days
  const laterTasks = tasks.filter(
    (t) => t.status === 'pending' && !isOverdue(t.deadline) && !isWithinDays(t.deadline, 7),
  );
  if (laterTasks.length > 0) {
    sections.push({
      id: 'later',
      title: 'Later',
      tasks: laterTasks.sort((a, b) => {
        // Tasks with deadlines first
        if (a.deadline && !b.deadline) return -1;
        if (!a.deadline && b.deadline) return 1;
        if (a.deadline && b.deadline) {
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        }
        // Then by priority
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
    });
  }

  // Completed: Recently completed tasks (today)
  const completedTasks = tasks.filter((t) => isCompletedToday(t));
  if (completedTasks.length > 0) {
    sections.push({
      id: 'completed',
      title: 'Completed Today',
      tasks: completedTasks.sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
      collapsible: true,
      defaultCollapsed: true,
    });
  }

  return sections;
}

interface TaskSectionProps {
  section: TaskSection;
  onStatusChange: (taskId: string, completed: boolean) => void;
}

function TaskSectionView({ section, onStatusChange }: TaskSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(section.defaultCollapsed ?? false);

  return (
    <section className="space-y-1">
      {/* Section Header */}
      <div className="flex items-center gap-2 px-1 py-2">
        {section.collapsible ? (
          <button
            type="button"
            onClick={() => {
              setIsCollapsed(!isCollapsed);
            }}
            className="text-on-surface-variant hover:text-on-surface flex items-center gap-1 transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <span className="text-xs font-semibold tracking-wide uppercase">{section.title}</span>
          </button>
        ) : (
          <span className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
            {section.title}
          </span>
        )}
        <span className="text-on-surface-variant/60 text-xs">{section.tasks.length}</span>
      </div>

      {/* Section Content */}
      {!isCollapsed && (
        <div className="space-y-0.5">
          {section.tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              variant="list"
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export interface TaskListViewProps {
  /** Optional class name */
  className?: string;
}

/**
 * Task list view with smart sections.
 */
export function TaskListView({ className }: TaskListViewProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all');

  // Fetch tasks
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', { priority: priorityFilter === 'all' ? undefined : priorityFilter }],
    queryFn: async () => {
      const params: { priority?: TaskPriority } = {};
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      return tasksApi.list(params);
    },
  });

  // Status update mutation
  const statusMutation = useMutation({
    mutationFn: async ({ taskId, completed }: { taskId: string; completed: boolean }) => {
      await tasksApi.update(taskId, { status: completed ? 'completed' : 'pending' });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const handleStatusChange = useCallback(
    (taskId: string, completed: boolean) => {
      statusMutation.mutate({ taskId, completed });
    },
    [statusMutation],
  );

  // Filter and organize tasks
  const sections = useMemo(() => {
    if (!data?.data) return [];

    let tasks = data.data;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(query) || t.description?.toLowerCase().includes(query),
      );
    }

    return organizeTasks(tasks);
  }, [data?.data, searchQuery]);

  const totalTasks = sections.reduce((sum, s) => sum + s.tasks.length, 0);

  if (isLoading) {
    return (
      <div className={cn('space-y-6', className)}>
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <p className="text-on-surface-variant">Failed to load tasks</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="text-on-surface-variant absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className={cn(
              'bg-surface-container-low border-outline-variant placeholder:text-on-surface-variant/50',
              'w-full rounded-lg border py-2 pr-4 pl-10 text-sm',
              'focus:border-primary focus:ring-primary/30 focus:ring-1 focus:outline-none',
              'transition-colors duration-150',
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="text" size="sm">
                <Filter className="mr-1.5 h-4 w-4" />
                {priorityFilter === 'all' ? 'Priority' : priorityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Filter by Priority</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setPriorityFilter('all');
                }}
              >
                All
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPriorityFilter('urgent');
                }}
              >
                Urgent
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPriorityFilter('high');
                }}
              >
                High
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPriorityFilter('medium');
                }}
              >
                Medium
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPriorityFilter('low');
                }}
              >
                Low
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <QuickCreateTask
            onCreated={() => {
              void queryClient.invalidateQueries({ queryKey: ['tasks'] });
            }}
          />
        </div>
      </div>

      {/* Content */}
      {totalTasks === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-on-surface-variant mb-4">
            {searchQuery ? 'No tasks match your search' : 'No tasks yet'}
          </p>
          {!searchQuery && (
            <div className="w-full max-w-sm">
              <QuickCreateTask
                onCreated={() => {
                  void queryClient.invalidateQueries({ queryKey: ['tasks'] });
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <TaskSectionView
              key={section.id}
              section={section}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
