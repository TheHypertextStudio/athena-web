/**
 * Tasks page.
 *
 * Displays all tasks organized into smart sections (Focus, Up Next, Later, Completed).
 * Uses route interception for task details - clicking a task opens a modal overlay.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { TasksSurface } from '@/components/tasks/surfaces/TasksSurface';
import { SurfaceContainer } from '@/components/ui/surface';
import { projectsApi, type Project } from '@/lib/api-client';

/** Width for the tasks surface container - matches day view on home */
const SURFACE_WIDTH = 560;

export default function TasksPage() {
  const prefersReducedMotion = useReducedMotion();

  // Fetch projects for filtering and assignment
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list({ status: 'active' }),
  });

  const projects: { id: string; name: string }[] =
    projectsData?.data.map((p: Project) => ({ id: p.id, name: p.name })) ?? [];

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
          <TasksSurface className="h-full" projects={projects} />
        </SurfaceContainer>
      </motion.div>
    </main>
  );
}
