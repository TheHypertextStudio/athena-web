'use client';

import {
  EntityNavigationSnapshot,
  type EntityNavigationSnapshot as EntityNavigationSnapshotValue,
} from '@docket/types';

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
