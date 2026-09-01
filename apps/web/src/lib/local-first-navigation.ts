'use client';

import {
  EntityNavigationSnapshot,
  ProjectNavigationSnapshot,
  TaskNavigationSnapshot,
  type EntityNavigationSnapshot as EntityNavigationSnapshotValue,
} from './contracts/entity-navigation';
import { type ProjectOut } from './contracts/project';
import { type TaskOut } from '@docket/work/task-model';

import { navigateAuthenticated, type AuthenticatedNavigationOptions } from '@/lib/app-location';
import { seedNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';

/**
 * Seed and open one entity through the validated authenticated browser transport.
 *
 * @param snapshot - Identity and core state carried by the source row.
 * @param options - Browser history behavior.
 */
export function openEntity(
  snapshot: EntityNavigationSnapshotValue,
  options: AuthenticatedNavigationOptions = {},
): void {
  const validated = EntityNavigationSnapshot.parse(snapshot);
  seedNavigationSnapshot(validated);
  switch (validated.target) {
    case 'task':
      navigateAuthenticated(
        '/orgs/[orgId]/tasks/[taskId]',
        { orgId: validated.organizationId, taskId: validated.id },
        options,
      );
      return;
    case 'project':
      navigateAuthenticated(
        '/orgs/[orgId]/projects/[projectId]',
        { orgId: validated.organizationId, projectId: validated.id },
        options,
      );
      return;
    case 'program':
      navigateAuthenticated(
        '/orgs/[orgId]/programs/[programId]',
        { orgId: validated.organizationId, programId: validated.id },
        options,
      );
      return;
    case 'initiative':
      navigateAuthenticated(
        '/orgs/[orgId]/initiatives/[initiativeId]',
        { orgId: validated.organizationId, initiativeId: validated.id },
        options,
      );
  }
}

/** Seed and open a Task record when its source includes the required snapshot recency field. */
export function openTaskRecord(task: TaskOut, options: AuthenticatedNavigationOptions = {}): void {
  openEntity(
    TaskNavigationSnapshot.parse({
      target: 'task',
      organizationId: task.organizationId,
      id: task.id,
      title: task.title,
      status: task.state,
      priority: task.priority,
      updatedAt: task.updatedAt,
    }),
    options,
  );
}

/** Seed and open a Project record when its source includes the required snapshot recency field. */
export function openProjectRecord(
  project: ProjectOut,
  options: AuthenticatedNavigationOptions = {},
): void {
  openEntity(
    ProjectNavigationSnapshot.parse({
      target: 'project',
      organizationId: project.organizationId,
      id: project.id,
      name: project.name,
      status: project.status,
      priority: project.priority,
      health: project.health ?? null,
      updatedAt: project.updatedAt,
    }),
    options,
  );
}
