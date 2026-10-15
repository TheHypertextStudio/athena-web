'use client';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys } from '@/lib/query';

/** Bounded archive references share the canonical template cache and typed API transport. */
export function workTemplateArchiveImpactDef(
  orgId: string,
  id: string,
  parentOffset = 0,
  scheduleOffset = 0,
) {
  return apiQueryOptions(
    [
      ...queryKeys.templates(orgId),
      'definition',
      id,
      'archive-impact',
      parentOffset,
      scheduleOffset,
    ],
    () =>
      api.v1.orgs[':orgId'].templates.definitions[':id']['archive-impact'].$get({
        param: { orgId, id },
        query: {
          parentOffset: String(parentOffset),
          scheduleOffset: String(scheduleOffset),
          limit: '20',
        },
      }),
    'Could not review template archive impact.',
  );
}
