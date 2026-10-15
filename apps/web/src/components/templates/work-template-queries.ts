'use client';
import {
  type WorkTemplateCreate,
  type WorkTemplateDraftUpdate,
  type WorkTemplatePublish,
} from '@docket/work/work-template-contract';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, unwrap, useApiMutation } from '@/lib/query';

/** Canonical template discovery shared by settings, composers, and commands. */
export function workTemplatesDef(
  orgId: string,
  options: {
    targetType?: TemplateTargetType;
    includeDrafts?: boolean;
    includeArchived?: boolean;
  } = {},
) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'definitions', options],
    () =>
      api.v1.orgs[':orgId'].templates.definitions.$get({
        param: { orgId },
        query: {
          ...(options.targetType ? { targetType: options.targetType } : {}),
          includeDrafts: options.includeDrafts ? 'true' : 'false',
          includeArchived: options.includeArchived ? 'true' : 'false',
        },
      }),
    'Could not load work templates.',
    { staleTime: STALE.static },
  );
}

/** One authorized template and its reviewed draft revision. */
export function workTemplateDef(orgId: string, id: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'definition', id],
    () => api.v1.orgs[':orgId'].templates.definitions[':id'].$get({ param: { orgId, id } }),
    'Could not load the template.',
  );
}

/** Immutable template history for settings and update decisions. */
export function workTemplateVersionsDef(orgId: string, id: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'definition', id, 'versions'],
    () =>
      api.v1.orgs[':orgId'].templates.definitions[':id'].versions.$get({ param: { orgId, id } }),
    'Could not load template history.',
  );
}

/** Draft, publication and archive mutations through the canonical typed API. */
export function useWorkTemplateWrites(orgId: string) {
  const invalidateKeys = [queryKeys.templates(orgId)];
  return {
    create: useApiMutation({
      mutationFn: (input: WorkTemplateCreate) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions.$post({ param: { orgId }, json: input }),
          'Could not save the template draft.',
        ),
      invalidateKeys,
    }),
    draft: useApiMutation({
      mutationFn: ({ id, ...input }: WorkTemplateDraftUpdate & { id: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions[':id'].draft.$patch({
              param: { orgId, id },
              json: input,
            }),
          'Could not save the template draft.',
        ),
      invalidateKeys,
    }),
    publish: useApiMutation({
      mutationFn: ({ id, ...input }: WorkTemplatePublish & { id: string }) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions[':id'].publish.$post({
              param: { orgId, id },
              json: input,
            }),
          'Could not publish the template.',
        ),
      invalidateKeys,
    }),
    archive: useApiMutation({
      mutationFn: (id: string) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].templates.definitions[':id'].archive.$post({
              param: { orgId, id },
            }),
          'Could not archive the template.',
        ),
      invalidateKeys,
    }),
  };
}
