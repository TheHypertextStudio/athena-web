'use client';

/** Start durable, owner-bound Athena work on an existing task. */
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkEntityId } from '@docket/work/ids';

import { api } from '@/lib/api';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

/**
 * Submit one personal assignment through Docket's authenticated API.
 *
 * @param organizationId - The task's workspace.
 * @param taskId - The existing task Athena should work on.
 * @returns Mutation state and an action that accepts the owner's objective.
 */
export function useTaskAthenaAssignment(organizationId: string, taskId: string) {
  return useApiMutation({
    mutationFn: (objective: string) =>
      unwrap(
        () =>
          api.v1.me.athena.assignments.$post({
            json: {
              organizationId: OrganizationId.parse(organizationId),
              entityType: 'task',
              entityId: WorkEntityId.parse(taskId),
              objective,
            },
          }),
        'Could not start Athena on this task.',
      ),
    invalidateKeys: [queryKeys.athena(), queryKeys.notifications()],
    failure: 'silent',
  });
}
