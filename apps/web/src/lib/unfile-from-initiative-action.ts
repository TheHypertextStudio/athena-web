/**
 * "Remove from this initiative" as a property of the Project or Program, not of the panel.
 *
 * @remarks
 * Registered on the object's own domain so the overflow button and the right-click menu offer it
 * identically, and so no surface has to build a second menu to carry one item. It appears only on
 * the Initiative's Connected work list, and only for a link that list actually owns.
 */
import type { ActionContext, ActionResponsiveness } from '@/lib/actions/types';
import type { QueryClient } from '@tanstack/react-query';
import { X } from '@docket/ui/icons';

import { api } from '@/lib/api';
import { unwrap } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

/**
 * The Initiative one row was reached through, when the surface says the link can be cut there.
 *
 * @remarks
 * Read off the row's own `meta` rather than passed down from the panel, so the action stays a
 * property of the object and shows up identically in the overflow button and the right-click
 * menu. The meta is what scopes it: only an Initiative's connected-work list states which
 * Initiative a row was reached through, so no other surface can offer this by accident.
 *
 * An indirect link — one inherited from a sub-initiative — reports `null`: the edge exists
 * somewhere else, and cutting it from here would either do nothing or cut the wrong one.
 *
 * @param context - The invocation context.
 * @returns The Initiative id, or `null` when this row cannot be unfiled here.
 */
function unfilableInitiativeId(context: ActionContext): string | null {
  if (context.objects.length !== 1) return null;
  const meta = context.objects[0]?.meta;
  if (meta?.['directLink'] !== true) return null;
  const initiativeId = meta['initiativeId'];
  return typeof initiativeId === 'string' ? initiativeId : null;
}

/**
 * Build the unfile action for one kind of work.
 *
 * @param kind - Whether this is the Project or the Program definition.
 * @param queryClient - The cache refreshed after the link is cut.
 * @param responsiveness - The domain's own relation responsiveness metadata.
 * @returns the action definition.
 */
export function unfileFromInitiativeAction(
  kind: 'project' | 'program',
  queryClient: QueryClient,
  responsiveness: ActionResponsiveness,
) {
  return {
    id: `${kind}.removeFromInitiative`,
    label: 'Remove from this initiative',
    icon: X,
    objectKinds: [kind],
    section: 'organize',
    destructive: true,
    appliesTo: (context: ActionContext) => unfilableInitiativeId(context) !== null,
    responsiveness,
    run: async (context: ActionContext) => {
      const initiativeId = unfilableInitiativeId(context);
      const subject = context.objects[0];
      if (initiativeId === null || subject === undefined) return;
      const orgId = subject.organizationId;
      if (orgId === null) return;
      await unwrap(
        () =>
          kind === 'project'
            ? api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
                param: { orgId, id: initiativeId, projectId: subject.id },
              })
            : api.v1.orgs[':orgId'].initiatives[':id'].programs[':programId'].$delete({
                param: { orgId, id: initiativeId, programId: subject.id },
              }),
        'Could not remove it from the initiative.',
      );
      await invalidateWorkTargetQueries(queryClient, {
        target: 'initiative',
        ownerOrganizationId: orgId,
      });
      await invalidateWorkTargetQueries(queryClient, {
        target: kind,
        ownerOrganizationId: orgId,
      });
    },
  } as const;
}
