import { api } from './api';
import { unwrap } from './query';
import type { UploadControl } from './resumable-upload';

/** Typed metadata operations; callers run these within their useApiMutation upload workflow. */
export function uploadControl(orgId: string): UploadControl {
  const route = api.v1.orgs[':orgId'].uploads;
  const param = { orgId };
  return {
    begin: (json) =>
      unwrap(() => route.$post({ param, json }), 'Could not prepare the file upload.'),
    status: (id) =>
      unwrap(
        () => route[':id'].$get({ param: { orgId, id } }),
        'Could not recover upload progress.',
      ),
    complete: (id) =>
      unwrap(
        () => route[':id'].completion.$post({ param: { orgId, id } }),
        'Could not finish the file upload.',
      ),
    cancel: (id) =>
      unwrap(() => route[':id'].$delete({ param: { orgId, id } }), 'Could not remove the upload.'),
  };
}
