'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateCaptureRequest } from '@docket/work/work-template-contract';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation } from '@/lib/query';
import { workTargetCollectionKey } from '@/lib/query-keys';

/** Cached workspace policy for the existing Save-as authoring affordance. */
export function captureAuthoringPolicyDef(orgId: string) {
  return apiQueryOptions(
    queryKeys.organization(orgId),
    () => api.v1.orgs[':orgId'].$get({ param: { orgId } }),
    'Could not load template permissions.',
  );
}
function capturePreview(orgId: string, kind: TemplateTargetType, id: string) {
  const resources = api.v1.orgs[':orgId'];
  const input = { param: { orgId, id } };
  switch (kind) {
    case 'task':
      return resources.tasks[':id'].template['save-as'].preview.$post(input);
    case 'project':
      return resources.projects[':id'].template['save-as'].preview.$post(input);
    case 'initiative':
      return resources.initiatives[':id'].template['save-as'].preview.$post(input);
    case 'program':
      return resources.programs[':id'].template['save-as'].preview.$post(input);
  }
}
/** Fetch a fresh authorized independent outline only while its capture review is open. */
export function workTemplateCapturePreviewDef(
  orgId: string,
  kind: TemplateTargetType,
  id: string,
  enabled: boolean,
) {
  return apiQueryOptions(
    [...workTargetCollectionKey(orgId, kind), id, 'save-as-preview'],
    () => capturePreview(orgId, kind, id),
    'Could not review this outline for reuse.',
    { enabled, staleTime: 0 },
  );
}
function saveCapture(
  orgId: string,
  kind: TemplateTargetType,
  id: string,
  json: WorkTemplateCaptureRequest,
) {
  const resources = api.v1.orgs[':orgId'];
  const input = { param: { orgId, id }, json };
  switch (kind) {
    case 'task':
      return resources.tasks[':id'].template['save-as'].$post(input);
    case 'project':
      return resources.projects[':id'].template['save-as'].$post(input);
    case 'initiative':
      return resources.initiatives[':id'].template['save-as'].$post(input);
    case 'program':
      return resources.programs[':id'].template['save-as'].$post(input);
  }
}
/** Save only the reviewed name and source token; publication remains a separate editor action. */
export function useWorkTemplateCapture(orgId: string, kind: TemplateTargetType, id: string) {
  return useApiMutation({
    mutationFn: (input: WorkTemplateCaptureRequest) =>
      unwrap(
        () => saveCapture(orgId, kind, id, input),
        'Could not save this outline as a template.',
      ),
    invalidateKeys: [queryKeys.templates(orgId)],
  });
}
