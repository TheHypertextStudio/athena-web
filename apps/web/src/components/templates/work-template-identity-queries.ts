'use client';

import type { TemplateTargetType } from '@docket/work/template-contract';
import type {
  WorkTemplateAssignment,
  WorkTemplateChangeRequest,
} from '@docket/work/work-template-reference';
import { api } from '@/lib/api';
import {
  apiInfiniteQueryOptions,
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiMutation,
} from '@/lib/query';
import { workTargetCollectionKey } from '@/lib/query-keys';

/** Read one pinned identity; absence in a retained cache never invents a base association. */
export function workTemplateIdentityDef(orgId: string, id?: string, versionId?: string) {
  return apiQueryOptions(
    [...queryKeys.templates(orgId), 'identity', id, versionId],
    () =>
      api.v1.orgs[':orgId'].templates.definitions[':id'].identity[':versionId'].$get({
        param: { orgId, id: id ?? '', versionId: versionId ?? '' },
      }),
    'Could not load the template identity.',
    { enabled: Boolean(id && versionId) },
  );
}

/** Fetch published header choices only when opened, without authoring drafts or starting bodies. */
export function workTemplateChoicesDef(
  orgId: string,
  kind: TemplateTargetType,
  teamId: string | null,
  enabled: boolean,
) {
  return apiInfiniteQueryOptions(
    [...queryKeys.templates(orgId), 'identity-choices', kind, teamId],
    (cursor) =>
      api.v1.orgs[':orgId'].templates.definitions.identities.$get({
        param: { orgId },
        query: { targetType: kind, ...(teamId ? { teamId } : {}), ...(cursor ? { cursor } : {}) },
      }),
    (page) => page.nextCursor,
    'Could not load template choices.',
    { enabled },
  );
}

function preview(
  orgId: string,
  kind: TemplateTargetType,
  id: string,
  json: WorkTemplateChangeRequest,
) {
  const resources = api.v1.orgs[':orgId'];
  const input = { param: { orgId, id }, json };
  switch (kind) {
    case 'task':
      return resources.tasks[':id'].template.preview.$post(input);
    case 'project':
      return resources.projects[':id'].template.preview.$post(input);
    case 'initiative':
      return resources.initiatives[':id'].template.preview.$post(input);
    case 'program':
      return resources.programs[':id'].template.preview.$post(input);
  }
}

/** Load differences for one authorized item and exact publication, never its editable draft. */
export function workTemplateChangePreviewDef(
  orgId: string,
  kind: TemplateTargetType,
  id: string,
  selection: WorkTemplateChangeRequest | null,
) {
  return apiQueryOptions(
    [...workTargetCollectionKey(orgId, kind), id, 'template-preview', selection],
    () => {
      if (!selection) throw new Error('Choose a template to preview.');
      return preview(orgId, kind, id, selection);
    },
    'Could not preview the template changes.',
    { enabled: selection !== null, staleTime: 0 },
  );
}

function assign(orgId: string, kind: TemplateTargetType, id: string, json: WorkTemplateAssignment) {
  const resources = api.v1.orgs[':orgId'];
  const input = { param: { orgId, id }, json };
  switch (kind) {
    case 'task':
      return resources.tasks[':id'].template.$post(input);
    case 'project':
      return resources.projects[':id'].template.$post(input);
    case 'initiative':
      return resources.initiatives[':id'].template.$post(input);
    case 'program':
      return resources.programs[':id'].template.$post(input);
  }
}

/** Submit the reviewed identity, then refresh the owning work collection, views and identity. */
export function useWorkTemplateAssignment(orgId: string, kind: TemplateTargetType, id: string) {
  return useApiMutation({
    failure: 'silent',
    mutationFn: (selection: WorkTemplateAssignment) =>
      unwrap(() => assign(orgId, kind, id, selection), 'Could not change the template.'),
    invalidateKeys: [
      workTargetCollectionKey(orgId, kind),
      queryKeys.templates(orgId),
      queryKeys.views(orgId),
    ],
  });
}
