/**
 * Intercepted modal route for initiative details.
 *
 * Reuses InitiativeDetailModal for quick preview without
 * leaving the current page context.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cn } from '@/lib/utils';
import { InitiativeDetailModal } from '@/components/initiatives/initiative-detail-modal';
import { initiativesApi, projectsApi, tasksApi } from '@/lib/api-client';

export default function InitiativeModalPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  // Fetch initiative
  const {
    data: initiativeData,
    isLoading: isLoadingInitiative,
    error: initiativeError,
  } = useQuery({
    queryKey: ['initiative', id],
    queryFn: () => initiativesApi.get(id),
    enabled: !!id,
  });

  // Fetch projects for this initiative
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects', { initiativeId: id }],
    queryFn: () => projectsApi.list({ initiativeId: id }),
    enabled: !!id,
  });

  // Fetch all tasks
  const { data: tasksData, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.list(),
    enabled: Boolean(projectsData?.data && projectsData.data.length > 0),
  });

  const initiative = initiativeData?.data ?? null;
  const projects = projectsData?.data ?? [];
  const allTasks = tasksData?.data ?? [];

  const isLoading = isLoadingInitiative || isLoadingProjects || isLoadingTasks;
  const error = initiativeError instanceof Error ? initiativeError.message : null;

  // Calculate task counts
  const taskCounts = useMemo(() => {
    if (projects.length === 0) return { total: 0, completed: 0 };
    const projectIds = new Set(projects.map((p) => p.id));
    const relatedTasks = allTasks.filter((t) => t.projectId && projectIds.has(t.projectId));
    const completed = relatedTasks.filter((t) => t.status === 'completed').length;
    return { total: relatedTasks.length, completed };
  }, [projects, allTasks]);

  const progress = useMemo(() => {
    if (taskCounts.total === 0) return 0;
    return Math.round((taskCounts.completed / taskCounts.total) * 100);
  }, [taskCounts]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleExpand = useCallback(() => {
    router.push(`/initiatives/${id}`);
  }, [router, id]);

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
            'fixed top-[10%] left-1/2 z-50 w-full max-w-md -translate-x-1/2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-200 outline-none',
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <VisuallyHidden asChild>
            <Dialog.Title>{initiative?.name ?? 'Initiative Details'}</Dialog.Title>
          </VisuallyHidden>
          <VisuallyHidden asChild>
            <Dialog.Description>View initiative progress and quick actions.</Dialog.Description>
          </VisuallyHidden>

          <InitiativeDetailModal
            initiative={initiative}
            isLoading={isLoading}
            error={error}
            onClose={handleClose}
            onExpand={handleExpand}
            progress={progress}
            taskCounts={taskCounts}
            projectCount={projects.length}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
