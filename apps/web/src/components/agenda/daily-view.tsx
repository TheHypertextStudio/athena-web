/**
 * Daily agenda view component.
 *
 * Supports two grouping modes:
 * - Time-based (default): Tasks grouped by focus/later
 * - Initiative-based: Tasks grouped by their parent initiative
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useState, useMemo } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Target, Layers, Clock } from 'lucide-react';
import Link from 'next/link';
import { useAgendaToday, useReorderTasks, isToday, getTodayDate } from '@/hooks/use-agenda';
import { agendaKeys } from '@/lib/agenda-api';
import { initiativesApi, projectsApi } from '@/lib/api-client';
import type { Task, Event, Initiative } from '@/lib/api-client';
import { TimeUtilization } from './time-utilization';
import { SortableTaskList } from './sortable-task-list';
import { AgendaTaskItem } from './agenda-task-item';
import { AgendaEventItem } from './agenda-event-item';
import { QuickCreateTask, QuickCreateEvent } from './quick-create';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cn } from '@/lib/utils';

type GroupBy = 'time' | 'initiative';

interface DailyViewProps {
  /** The date to display (YYYY-MM-DD) */
  date: string;
}

/**
 * Grouping toggle button.
 */
function GroupByToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (value: GroupBy) => void;
}) {
  return (
    <div className="bg-surface-container-high flex items-center gap-1 rounded-lg p-1">
      <button
        type="button"
        onClick={() => {
          onChange('time');
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'time'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        Time
      </button>
      <button
        type="button"
        onClick={() => {
          onChange('initiative');
        }}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          value === 'initiative'
            ? 'bg-primary text-on-primary'
            : 'text-on-surface-variant hover:text-on-surface',
        )}
      >
        <Target className="h-3.5 w-3.5" />
        Initiative
      </button>
    </div>
  );
}

interface InitiativeGroup {
  initiative: Initiative | null;
  tasks: Task[];
  progress: number;
  totalMinutes: number;
}

/**
 * Initiative group header component.
 */
function InitiativeGroupHeader({ group }: { group: InitiativeGroup }) {
  const totalTime = group.tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);

  if (!group.initiative) {
    return (
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Layers className="text-on-surface-variant h-4 w-4" />
          <span className="text-on-surface-variant text-sm font-medium">No Initiative</span>
        </div>
        <div className="text-on-surface-variant flex items-center gap-3 text-xs">
          <span>{group.tasks.length} tasks</span>
          {totalTime > 0 && <span>{totalTime}m</span>}
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/initiatives/${group.initiative.id}`}
      className="group flex items-center justify-between py-2"
    >
      <div className="flex items-center gap-2">
        <Target className="text-primary h-4 w-4" />
        <span className="text-on-surface group-hover:text-primary text-sm font-medium transition-colors">
          {group.initiative.name}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <ProgressBar progress={group.progress} size="sm" className="w-20" />
        <span className="text-on-surface-variant text-xs tabular-nums">{group.progress}%</span>
        <span className="text-on-surface-variant text-xs">{group.tasks.length} tasks</span>
        {totalTime > 0 && <span className="text-on-surface-variant text-xs">{totalTime}m</span>}
      </div>
    </Link>
  );
}

/**
 * Daily view showing today's tasks and events.
 *
 * Supports grouping by time (default) or by initiative.
 */
export function DailyView({ date }: DailyViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAgendaToday();
  const reorderMutation = useReorderTasks();
  const [groupBy, setGroupBy] = useState<GroupBy>('time');

  // Fetch initiatives and projects for grouping
  const { data: initiativesData } = useQuery({
    queryKey: ['initiatives', { category: 'active' }],
    queryFn: () => initiativesApi.list({ category: 'active' }),
    enabled: groupBy === 'initiative',
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: groupBy === 'initiative',
  });

  // Only show today's data if the date is today
  // For other dates, we'd use useAgendaDay(date) instead
  const showTodayView = isToday(date);

  const handleTaskStatusChange = useCallback(
    (_taskId: string, _completed: boolean) => {
      // Invalidate queries to refetch data
      void queryClient.invalidateQueries({ queryKey: agendaKeys.today() });
      void queryClient.invalidateQueries({ queryKey: agendaKeys.day(date) });
    },
    [queryClient, date],
  );

  const handleReorder = useCallback(
    (taskIds: string[]) => {
      reorderMutation.mutate({ taskIds, date: getTodayDate() });
    },
    [reorderMutation],
  );

  // Group tasks by initiative
  const initiativeGroups = useMemo((): InitiativeGroup[] => {
    if (!data || groupBy !== 'initiative') return [];

    const tasks = data.data.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );
    const projects = projectsData?.data ?? [];
    const initiatives = initiativesData?.data ?? [];

    // Create a map of project ID to initiative
    const projectToInitiative = new Map<string, Initiative>();
    for (const project of projects) {
      if (project.initiativeId) {
        const initiative = initiatives.find((i) => i.id === project.initiativeId);
        if (initiative) {
          projectToInitiative.set(project.id, initiative);
        }
      }
    }

    // Group tasks by initiative
    const groups = new Map<string | null, Task[]>();
    for (const task of tasks) {
      const initiative = task.projectId ? projectToInitiative.get(task.projectId) : null;
      const key = initiative?.id ?? null;
      const existing = groups.get(key) ?? [];
      existing.push(task);
      groups.set(key, existing);
    }

    // Calculate progress for each initiative
    const allTasks = data.data.tasks;
    const result: InitiativeGroup[] = [];

    // First add initiatives with tasks
    for (const initiative of initiatives) {
      const tasksInGroup = groups.get(initiative.id);
      if (tasksInGroup && tasksInGroup.length > 0) {
        // Calculate overall initiative progress
        const initiativeProjects = projects.filter((p) => p.initiativeId === initiative.id);
        const projectIds = new Set(initiativeProjects.map((p) => p.id));
        const initiativeTasks = allTasks.filter((t) => t.projectId && projectIds.has(t.projectId));
        const completedCount = initiativeTasks.filter((t) => t.status === 'completed').length;
        const progress =
          initiativeTasks.length > 0
            ? Math.round((completedCount / initiativeTasks.length) * 100)
            : 0;

        result.push({
          initiative,
          tasks: tasksInGroup,
          progress,
          totalMinutes: tasksInGroup.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0),
        });
        groups.delete(initiative.id);
      }
    }

    // Add tasks without initiative
    const unassigned = groups.get(null);
    if (unassigned && unassigned.length > 0) {
      result.push({
        initiative: null,
        tasks: unassigned,
        progress: 0,
        totalMinutes: unassigned.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0),
      });
    }

    return result;
  }, [data, groupBy, projectsData, initiativesData]);

  if (isLoading) {
    return <DailyViewSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Failed to load agenda</p>
      </div>
    );
  }

  if (!showTodayView || !data) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Select today to view your agenda</p>
      </div>
    );
  }

  const { tasks, events, summary } = data.data;

  // Separate tasks by status
  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-6 p-6">
      {/* Time Utilization */}
      <TimeUtilization summary={summary} />

      {/* Tasks Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            Tasks ({pendingTasks.length})
          </h2>
          <GroupByToggle value={groupBy} onChange={setGroupBy} />
        </div>

        {groupBy === 'time' ? (
          // Time-based view (default)
          <>
            <SortableTaskList
              tasks={pendingTasks}
              onReorder={handleReorder}
              onTaskStatusChange={handleTaskStatusChange}
            />

            {/* Quick Create Task */}
            <div className="mt-3">
              <QuickCreateTask date={date} />
            </div>
          </>
        ) : (
          // Initiative-based view
          <div className="space-y-4">
            {initiativeGroups.map((group) => (
              <div key={group.initiative?.id ?? 'no-initiative'} className="space-y-2">
                <InitiativeGroupHeader group={group} />
                <div className="space-y-2 pl-6">
                  {group.tasks.map((task) => (
                    <AgendaTaskItem
                      key={task.id}
                      task={task}
                      onStatusChange={handleTaskStatusChange}
                      showDragHandle={false}
                    />
                  ))}
                </div>
              </div>
            ))}

            {initiativeGroups.length === 0 && pendingTasks.length === 0 && (
              <p className="text-muted-foreground text-sm">No tasks for today</p>
            )}

            {/* Quick Create Task */}
            <div className="mt-3">
              <QuickCreateTask date={date} />
            </div>
          </div>
        )}

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <div className="mt-4">
            <h3 className="text-muted-foreground mb-2 text-xs font-medium">
              Completed ({completedTasks.length})
            </h3>
            <div className="space-y-2">
              {completedTasks.map((task: Task) => (
                <AgendaTaskItem
                  key={task.id}
                  task={task}
                  onStatusChange={handleTaskStatusChange}
                  showDragHandle={false}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Events Section */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          Events ({events.length})
        </h2>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No events scheduled for today</p>
        ) : (
          <div className="space-y-2">
            {events.map((event: Event) => (
              <AgendaEventItem key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* Quick Create Event */}
        <div className="mt-3">
          <QuickCreateEvent date={date} />
        </div>
      </section>
    </div>
  );
}

/**
 * Loading skeleton for daily view.
 */
function DailyViewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Time Utilization Skeleton */}
      <div className="bg-card rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-2 w-full" />
      </div>

      {/* Tasks Skeleton */}
      <section>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </section>

      {/* Events Skeleton */}
      <section>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  );
}
