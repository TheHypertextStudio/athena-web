/**
 * Initiative detail page.
 *
 * Displays a single initiative with:
 * - Header with name, status, description
 * - Rich metrics dashboard
 * - Projects section
 * - Aggregated tasks view
 *
 * @packageDocumentation
 */

'use client';

import { use, useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Pencil,
  Archive,
  Target,
  FolderKanban,
  Plus,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceContainer } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useSnackbar } from '@/components/ui/snackbar';
import { InitiativeMetrics, type InitiativeMetricsData } from '@/components/initiatives';
import { CustomInitiativeStatusBadge } from '@/components/initiatives/initiative-status-select';
import { useInitiativeStatuses, getDefaultInitiativeStatus } from '@/hooks/use-initiative-statuses';
import { initiativesApi, projectsApi, tasksApi, type Task, type Project } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** Width for the detail surface container */
const SURFACE_WIDTH = 720;

interface InitiativeDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Project health status based on progress.
 */
function getProjectHealth(
  completedTasks: number,
  totalTasks: number,
): 'on_track' | 'at_risk' | 'blocked' {
  if (totalTasks === 0) return 'on_track';
  const progress = completedTasks / totalTasks;
  if (progress >= 0.4) return 'on_track';
  if (progress >= 0.2) return 'at_risk';
  return 'blocked';
}

/**
 * Health indicator dots.
 */
function HealthIndicator({ health }: { health: 'on_track' | 'at_risk' | 'blocked' }) {
  const dots = health === 'on_track' ? 4 : health === 'at_risk' ? 2 : 1;
  const maxDots = 5;

  return (
    <div className="flex gap-0.5">
      {Array.from({ length: maxDots }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            i < dots
              ? health === 'on_track'
                ? 'bg-green-500'
                : health === 'at_risk'
                  ? 'bg-orange-500'
                  : 'bg-red-500'
              : 'bg-surface-container-highest',
          )}
        />
      ))}
    </div>
  );
}

/**
 * Project card in the initiative detail view.
 */
function ProjectCard({ project, tasks }: { project: Project; tasks: Task[] }) {
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const health = getProjectHealth(completedTasks, totalTasks);

  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-lg p-3 transition-colors',
        'bg-surface-container hover:bg-surface-container-high',
      )}
    >
      <FolderKanban className="text-on-surface-variant h-5 w-5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-on-surface truncate font-medium">{project.name}</span>
        </div>
        <div className="text-on-surface-variant mt-1 flex items-center gap-2 text-xs">
          <span>
            {completedTasks}/{totalTasks} tasks
          </span>
          <span className="text-outline">•</span>
          <div className="bg-surface-container-highest flex h-1 w-16 overflow-hidden rounded-full">
            <div
              className="bg-primary transition-all duration-500"
              style={{ width: `${String(progress)}%` }}
            />
          </div>
          <span className="tabular-nums">{progress}%</span>
        </div>
      </div>
      <HealthIndicator health={health} />
      <span
        className={cn(
          'text-xs font-medium',
          health === 'on_track'
            ? 'text-green-600 dark:text-green-400'
            : health === 'at_risk'
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-red-600 dark:text-red-400',
        )}
      >
        {health === 'on_track' ? 'On Track' : health === 'at_risk' ? 'At Risk' : 'Blocked'}
      </span>
      <ChevronRight className="text-on-surface-variant h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

/**
 * Task item in the aggregated task list.
 */
function TaskItem({ task, projectName }: { task: Task; projectName: string }) {
  const isOverdue =
    task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed';

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
        'hover:bg-surface-container-high',
      )}
    >
      <div
        className={cn(
          'h-4 w-4 rounded-full border-2',
          task.status === 'completed'
            ? 'border-green-500 bg-green-500'
            : task.status === 'in_progress'
              ? 'border-blue-500'
              : 'border-on-surface-variant/30',
        )}
      />
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm',
            task.status === 'completed' && 'text-on-surface-variant line-through',
            isOverdue && 'text-error',
          )}
        >
          {task.title}
        </span>
        <span className="text-on-surface-variant text-xs">{projectName}</span>
      </div>
      {task.estimatedMinutes && (
        <span className="text-on-surface-variant text-xs tabular-nums">
          {task.estimatedMinutes}m
        </span>
      )}
      {isOverdue && <AlertCircle className="text-error h-4 w-4" />}
    </Link>
  );
}

/**
 * Loading skeleton for the detail page.
 */
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-1 h-4 w-72" />
        </div>
        <Skeleton className="h-6 w-16" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-20 rounded-xl" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function InitiativeDetailPage({ params }: InitiativeDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  const [isArchiving, setIsArchiving] = useState(false);

  // Fetch initiative statuses to get archived status ID
  const { statuses: initiativeStatuses } = useInitiativeStatuses();
  const archivedStatus = getDefaultInitiativeStatus(initiativeStatuses, 'archived');

  // Fetch initiative
  const { data: initiativeData, isLoading: isLoadingInitiative } = useQuery({
    queryKey: ['initiative', id],
    queryFn: () => initiativesApi.get(id),
  });

  // Fetch metrics from API
  const { data: metricsData } = useQuery({
    queryKey: ['initiative', id, 'metrics'],
    queryFn: () => initiativesApi.getMetrics(id),
    enabled: !!id,
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: () => {
      if (!archivedStatus) {
        throw new Error('No archived status available');
      }
      return initiativesApi.update(id, { statusId: archivedStatus.id });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['initiatives'] });
      snackbar.show({ message: 'Initiative archived' });
      router.push('/initiatives');
    },
    onError: () => {
      snackbar.show({ message: 'Failed to archive initiative' });
      setIsArchiving(false);
    },
  });

  // Handlers
  const handleArchive = useCallback(() => {
    if (isArchiving) return;
    setIsArchiving(true);
    archiveMutation.mutate();
  }, [isArchiving, archiveMutation]);

  const handleAddProject = useCallback(() => {
    router.push(`/projects/new?initiativeId=${id}`);
  }, [router, id]);

  // Fetch projects for this initiative
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects', { initiativeId: id }],
    queryFn: () => projectsApi.list({ initiativeId: id }),
  });

  // Fetch all tasks to filter by project
  const { data: tasksData, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
  });

  const isLoading = isLoadingInitiative || isLoadingProjects || isLoadingTasks;
  const initiative = initiativeData?.data;
  const projects = projectsData?.data ?? [];
  const allTasks = tasksData?.data ?? [];

  // Get project IDs
  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);

  // Filter tasks by project
  const initiativeTasks = useMemo(
    () => allTasks.filter((t) => t.projectId && projectIds.has(t.projectId)),
    [allTasks, projectIds],
  );

  // Build project name map
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [projects]);

  // Build tasks by project map
  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of initiativeTasks) {
      if (task.projectId) {
        const existing = map.get(task.projectId) ?? [];
        existing.push(task);
        map.set(task.projectId, existing);
      }
    }
    return map;
  }, [initiativeTasks]);

  // Calculate metrics - use API data if available, fallback to calculated
  const metrics: InitiativeMetricsData = useMemo(() => {
    const apiMetrics = metricsData?.data;
    const completedTasks = initiativeTasks.filter((t) => t.status === 'completed');
    const inProgressTasks = initiativeTasks.filter((t) => t.status === 'in_progress');
    const pendingTasks = initiativeTasks.filter(
      (t) => t.status === 'pending' || t.status === 'cancelled',
    );

    const estimatedMinutes =
      apiMetrics?.estimatedMinutes ??
      initiativeTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
    const loggedMinutes =
      apiMetrics?.loggedMinutes ??
      completedTasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);

    // Use API weekly completions if available
    const weeklyCompletions = apiMetrics?.weeklyCompletions ?? [0, 0, 0, 0];

    const projectMetrics = projects.map((p) => {
      const projectTasks = tasksByProject.get(p.id) ?? [];
      const completed = projectTasks.filter((t) => t.status === 'completed').length;
      return {
        id: p.id,
        name: p.name,
        totalTasks: projectTasks.length,
        completedTasks: completed,
        health: getProjectHealth(completed, projectTasks.length),
      };
    });

    return {
      totalTasks: apiMetrics?.totalTasks ?? initiativeTasks.length,
      completedTasks: apiMetrics?.completedTasks ?? completedTasks.length,
      inProgressTasks: apiMetrics?.inProgressTasks ?? inProgressTasks.length,
      pendingTasks: pendingTasks.length,
      estimatedMinutes,
      loggedMinutes,
      remainingMinutes: estimatedMinutes - loggedMinutes,
      weeklyCompletions,
      projects: projectMetrics,
    };
  }, [initiativeTasks, projects, tasksByProject, metricsData]);

  // Group tasks by deadline proximity
  const groupedTasks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const todayTasks: Task[] = [];
    const thisWeekTasks: Task[] = [];
    const laterTasks: Task[] = [];

    for (const task of initiativeTasks) {
      if (task.status === 'completed') continue;

      if (!task.deadline) {
        laterTasks.push(task);
        continue;
      }

      const deadline = new Date(task.deadline);
      deadline.setHours(0, 0, 0, 0);

      if (deadline <= today) {
        todayTasks.push(task);
      } else if (deadline <= endOfWeek) {
        thisWeekTasks.push(task);
      } else {
        laterTasks.push(task);
      }
    }

    return { todayTasks, thisWeekTasks, laterTasks };
  }, [initiativeTasks]);

  if (isLoading) {
    return (
      <main className="h-screen overflow-hidden p-4 md:p-6">
        <motion.div
          className="mx-auto h-full"
          animate={{ maxWidth: SURFACE_WIDTH }}
          initial={false}
          transition={
            prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0, 0, 1] }
          }
        >
          <SurfaceContainer rounded="xl" padding="lg" className="h-full overflow-hidden">
            <DetailSkeleton />
          </SurfaceContainer>
        </motion.div>
      </main>
    );
  }

  if (!initiative) {
    return (
      <main className="flex h-screen items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-on-surface text-xl font-semibold">Initiative not found</h1>
          <p className="text-on-surface-variant mt-1">
            The initiative you're looking for doesn't exist.
          </p>
          <Button asChild className="mt-4">
            <Link href="/initiatives">Back to Initiatives</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden p-4 md:p-6">
      <motion.div
        className="mx-auto h-full"
        animate={{ maxWidth: SURFACE_WIDTH }}
        initial={false}
        transition={
          prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0, 0, 1] }
        }
      >
        <SurfaceContainer
          rounded="xl"
          padding="lg"
          className="flex h-full flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2">
              <Button
                variant="text"
                size="sm"
                onClick={() => {
                  router.push('/initiatives');
                }}
                className="text-on-surface-variant"
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Initiatives
              </Button>
              <div className="flex-1" />
              <Button variant="text" size="sm" asChild>
                <Link href={`/initiatives/${id}/edit`}>
                  <Pencil className="mr-1 h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button variant="text" size="sm" onClick={handleArchive} disabled={isArchiving}>
                <Archive className="mr-1 h-4 w-4" />
                {isArchiving ? 'Archiving...' : 'Archive'}
              </Button>
            </div>

            <div className="mt-4 flex items-start gap-4">
              <div className="bg-primary/10 text-primary flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl">
                <Target className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-on-surface text-xl font-bold">{initiative.name}</h1>
                  <CustomInitiativeStatusBadge status={initiative.customStatus} />
                </div>
                {initiative.description && (
                  <p className="text-on-surface-variant mt-1 text-sm">{initiative.description}</p>
                )}
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="mt-6 flex-1 space-y-6 overflow-y-auto">
            {/* Metrics */}
            <InitiativeMetrics metrics={metrics} />

            {/* Projects section */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-on-surface-variant text-sm font-medium tracking-wide uppercase">
                  Projects ({projects.length})
                </h2>
                <Button variant="text" size="sm" onClick={handleAddProject}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add Project
                </Button>
              </div>
              <div className="space-y-2">
                {projects.length === 0 ? (
                  <div className="bg-surface-container rounded-lg p-6 text-center">
                    <p className="text-on-surface-variant text-sm">
                      No projects yet. Add a project to start tracking work.
                    </p>
                  </div>
                ) : (
                  projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      tasks={tasksByProject.get(project.id) ?? []}
                    />
                  ))
                )}
              </div>
            </section>

            {/* Tasks section */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-on-surface-variant text-sm font-medium tracking-wide uppercase">
                  Tasks Across Projects
                </h2>
              </div>

              {initiativeTasks.length === 0 ? (
                <div className="bg-surface-container rounded-lg p-6 text-center">
                  <p className="text-on-surface-variant text-sm">
                    No tasks yet. Tasks from linked projects will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedTasks.todayTasks.length > 0 && (
                    <div>
                      <h3 className="text-on-surface-variant mb-2 text-xs font-medium">Today</h3>
                      <div className="bg-surface-container rounded-lg">
                        {groupedTasks.todayTasks.map((task) => (
                          <TaskItem
                            key={task.id}
                            task={task}
                            projectName={projectNameMap.get(task.projectId ?? '') ?? 'Unknown'}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {groupedTasks.thisWeekTasks.length > 0 && (
                    <div>
                      <h3 className="text-on-surface-variant mb-2 text-xs font-medium">
                        This Week
                      </h3>
                      <div className="bg-surface-container rounded-lg">
                        {groupedTasks.thisWeekTasks.map((task) => (
                          <TaskItem
                            key={task.id}
                            task={task}
                            projectName={projectNameMap.get(task.projectId ?? '') ?? 'Unknown'}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {groupedTasks.laterTasks.length > 0 && (
                    <div>
                      <h3 className="text-on-surface-variant mb-2 text-xs font-medium">Later</h3>
                      <div className="bg-surface-container rounded-lg">
                        {groupedTasks.laterTasks.slice(0, 5).map((task) => (
                          <TaskItem
                            key={task.id}
                            task={task}
                            projectName={projectNameMap.get(task.projectId ?? '') ?? 'Unknown'}
                          />
                        ))}
                        {groupedTasks.laterTasks.length > 5 && (
                          <div className="text-on-surface-variant px-3 py-2 text-center text-xs">
                            +{groupedTasks.laterTasks.length - 5} more tasks
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </SurfaceContainer>
      </motion.div>
    </main>
  );
}
