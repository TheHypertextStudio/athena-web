import type { ViewTarget } from '@docket/work/view-contract';

import type { ObjectRef } from '@/lib/actions';

import { type WorkViewRowFor, workViewRowTitle } from './renderer-types';

/** Project a server work-view row onto the canonical interaction identity. */
export function objectForWorkViewRow(row: WorkViewRowFor<ViewTarget>): ObjectRef {
  return {
    kind: row.target,
    id: row.id,
    organizationId: row.organizationId,
    title: workViewRowTitle(row),
    ...(row.target === 'initiative'
      ? {
          meta: {
            parentInitiativeId: row.parent,
            parentLinkId: row.parentLinkId,
          },
        }
      : {}),
  };
}
