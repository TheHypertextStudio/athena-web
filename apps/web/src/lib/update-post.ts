import type { UpdateListQuery, UpdateOut, UpdatePostInput } from '@docket/work/update-contract';
import { api } from './api';
import { unwrap } from './query';

/** Post the same typed, retryable update request from any container composer. */
export function postUpdateRequest(
  orgId: string,
  subject: UpdateListQuery,
  { requestId, ...body }: UpdatePostInput & { readonly requestId?: string },
): Promise<UpdateOut> {
  return unwrap(
    () =>
      api.v1.orgs[':orgId'].updates.$post(
        { param: { orgId }, json: { ...subject, ...body } },
        requestId ? { headers: { 'Idempotency-Key': requestId } } : undefined,
      ),
    'Could not post your update.',
  );
}
