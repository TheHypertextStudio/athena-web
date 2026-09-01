/**
 * Deferred Initiative hierarchy sections.
 *
 * @remarks
 * This read never participates in the document's first paint. The route requests it only after a
 * reader selects Sub-initiatives or Connected work.
 */
import type { InitiativeRelationshipSections } from '@docket/work/initiative-contract';

import { api } from './api';
import { apiQueryOptions, queryKeys } from './query';

/** Read the deferred hierarchy and connected-work sections for one Initiative. */
export function initiativeRelationshipSectionsDef(orgId: string, initiativeId: string) {
  return apiQueryOptions<InitiativeRelationshipSections>(
    [...queryKeys.initiative(orgId, initiativeId), 'relationship-sections'],
    () =>
      api.v1.orgs[':orgId'].initiatives[':id'].relationships.$get({
        param: { orgId, id: initiativeId },
      }),
    'Could not load Initiative relationships.',
  );
}
