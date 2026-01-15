/**
 * Initiatives page.
 *
 * Displays all initiatives with progress metrics and filtering.
 * The main entry point for managing strategic objectives.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { InitiativeListView, type InitiativeWithMetrics } from '@/components/initiatives';
import { SurfaceContainer } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { initiativesApi, projectsApi, tasksApi } from '@/lib/api-client';

/** Width for the initiatives surface container */
const SURFACE_WIDTH = 640;

/**
 * Loading skeleton for the initiatives page.
 */
function InitiativesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-20" />
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function InitiativesPage() {
  const prefersReducedMotion = useReducedMotion();

  // Fetch initiatives
  const { data: initiativesData, isLoading: isLoadingInitiatives } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesApi.list(),
  });

  // Fetch projects to calculate metrics per initiative
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  // Fetch all tasks to calculate metrics
  const { data: tasksData, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
  });

  const isLoading = isLoadingInitiatives || isLoadingProjects || isLoadingTasks;

  // Calculate metrics for each initiative
  const initiativesWithMetrics: InitiativeWithMetrics[] = (initiativesData?.data ?? []).map(
    (initiative) => {
      // Get projects for this initiative
      const projects = (projectsData?.data ?? []).filter((p) => p.initiativeId === initiative.id);
      const projectIds = new Set(projects.map((p) => p.id));

      // Get tasks for those projects
      const tasks = (tasksData?.data ?? []).filter(
        (t) => t.projectId && projectIds.has(t.projectId),
      );
      const completedTasks = tasks.filter((t) => t.status === 'completed').length;
      const totalTasks = tasks.length;

      // Calculate estimated hours remaining
      const remainingTasks = tasks.filter((t) => t.status !== 'completed');
      const estimatedMinutesRemaining = remainingTasks.reduce(
        (sum, t) => sum + (t.estimatedMinutes ?? 0),
        0,
      );
      const estimatedHoursRemaining = Math.round(estimatedMinutesRemaining / 60);

      // Check for child initiatives
      const hasChildren = (initiativesData?.data ?? []).some((i) => i.parentId === initiative.id);

      return {
        ...initiative,
        projectCount: projects.length,
        completedTasks,
        totalTasks,
        estimatedHoursRemaining: estimatedHoursRemaining > 0 ? estimatedHoursRemaining : undefined,
        hasChildren,
        // TODO: Add strategic priority field to initiative schema
        isStrategicPriority: false,
      };
    },
  );

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
          {isLoading ? (
            <InitiativesSkeleton />
          ) : (
            <InitiativeListView initiatives={initiativesWithMetrics} />
          )}
        </SurfaceContainer>
      </motion.div>
    </main>
  );
}
