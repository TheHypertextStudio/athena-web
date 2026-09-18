/**
 * `@docket/api` — saved composer drafts (mounted at `/v1/me/drafts`).
 *
 * @remarks
 * The autosave target for the five global create composers. A draft is personal: every route
 * here is keyed only by the authenticated user, and a workspace is named on a draft rather than
 * used to authorize it. Creating the real record goes through that record's own create route.
 */
import {
  ComposerDraftCreate,
  ComposerDraftListOut,
  ComposerDraftListQuery,
  ComposerDraftOut,
  ComposerDraftPatch,
} from '@docket/work/composer-draft-contract';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import {
  createDraft,
  deleteDraft,
  listOwnedDrafts,
  loadOwnedDraft,
  patchDraft,
  presentDraft,
} from '../lib/composer-draft/store';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';

/** Return the authenticated owner or fail closed. */
function requestOwner(c: { get(key: 'session'): AppEnv['Variables']['session'] }): string {
  const owner = c.get('session')?.user.id;
  if (!owner) throw new AuthError();
  return owner;
}

const idParam = z.object({ id: z.string() });

const meDrafts = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List drafts',
      response: ComposerDraftListOut,
      description: `List the caller's saved composer drafts that have not expired, most recently saved first. A draft is the unsent state of a create composer (task, project, initiative, program, or team), kept so the form can be picked back up later. Filter with \`kind\` to one composer and \`organizationId\` to one workspace; both are optional and combine. Session-only. **401** when unauthenticated. Returns {@link ComposerDraftListOut}.`,
    }),
    zQuery(ComposerDraftListQuery),
    async (c) => {
      const owner = requestOwner(c);
      const rows = await listOwnedDrafts(owner, c.req.valid('query'));
      return ok(c, ComposerDraftListOut, { items: rows.map(presentDraft) });
    },
  )
  .post(
    '/',
    apiDoc({
      status: 201,
      tag: 'Me',
      summary: 'Save a draft',
      response: ComposerDraftOut,
      description: `Save a new composer draft in a workspace the caller belongs to. \`kind\` names the composer and must equal \`payload.kind\`; every payload field is optional so a form can be saved at any point. The draft starts at revision 0 and expires 183 days after its last save. **404** when the caller is not a member of \`organizationId\`. **422** when \`kind\` and \`payload.kind\` disagree. Returns the {@link ComposerDraftOut} with **201**.`,
    }),
    zJson(ComposerDraftCreate),
    async (c) => {
      const owner = requestOwner(c);
      const row = await createDraft(owner, c.req.valid('json'));
      return created(c, ComposerDraftOut, presentDraft(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Get a draft',
      response: ComposerDraftOut,
      description: `Read one of the caller's drafts with its payload and current \`revision\`. **404** for an unknown or expired id, or another user's draft. Returns {@link ComposerDraftOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      const row = await loadOwnedDraft(owner, c.req.valid('param').id);
      return ok(c, ComposerDraftOut, presentDraft(row));
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Save a draft again',
      response: ComposerDraftOut,
      description: `Replace the draft's payload against the \`revision\` it was read at, bump the revision, and renew the expiry. **412** (\`precondition_failed\`) when the draft has moved past that revision — re-read the draft and save again from its current revision. **422** when \`payload.kind\` differs from the draft's kind. **404** for an unknown, expired, or foreign draft. Returns the updated {@link ComposerDraftOut}.`,
    }),
    zParam(idParam),
    zJson(ComposerDraftPatch),
    async (c) => {
      const owner = requestOwner(c);
      const row = await patchDraft(owner, c.req.valid('param').id, c.req.valid('json'));
      return ok(c, ComposerDraftOut, presentDraft(row));
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Discard a draft',
      status: 204,
      description: `Remove one of the caller's drafts. Nothing else is affected: a draft never became a real record. **404** for an unknown, expired, or foreign draft. Answers **204** with no body.`,
    }),
    zParam(idParam),
    async (c) => {
      const owner = requestOwner(c);
      await deleteDraft(owner, c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

export default meDrafts;
