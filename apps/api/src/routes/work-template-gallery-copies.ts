import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  WorkTemplateGalleryAcceptRequest,
  WorkTemplateCopyBundle,
  WorkTemplateCopyReceipt,
  WorkTemplateCopyUndoResult,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { apiDoc } from '../lib/openapi-route';
import { ok } from '../lib/ok';
import {
  acceptTemplateGalleryCopy,
  reconcileTemplateGalleryCopy,
} from '../lib/template-gallery/acceptance';
import { readTemplateGalleryCopyBundle } from '../lib/template-gallery/bundle';
import { undoTemplateGalleryCopy } from '../lib/template-gallery/undo-gallery';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import type { TemplateCopyPrincipal } from '../lib/templates/copy-reservation-context';

function principal(c: Context<AppEnv>): TemplateCopyPrincipal {
  const userId = c.get('principal')?.userId;
  if (!userId) throw new AuthError();
  return { organizationId: c.get('actorCtx').orgId, userId };
}
const bundleParam = z.object({ bundleId: z.ulid() });

/** Manual copy acceptance/reentry/Undo share current principal checks and the canonical receipt engine. */
const copies = new Hono<AppEnv>()
  .use('*', capabilityGuard('view', { sharedWorkMutation: false }))
  .post(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Keep reviewed independent work definitions',
      response: WorkTemplateCopyReceipt,
      description:
        'Keep the exact reviewed catalog selection as private drafts or explicitly publish it. Retry the same request identity and choices after an interrupted response. New writes recheck current authoring; known terminal outcomes require only current View rights and never overwrite later edits.',
    }),
    zJson(WorkTemplateGalleryAcceptRequest),
    async (c) =>
      ok(
        c,
        WorkTemplateCopyReceipt,
        await acceptTemplateGalleryCopy(principal(c), c.req.valid('json')),
      ),
  )
  .get(
    '/requests/:requestId',
    apiDoc({
      tag: 'Templates',
      summary: 'Reconcile the original work-copy outcome',
      response: WorkTemplateCopyReceipt,
    }),
    zParam(z.object({ requestId: z.uuid() })),
    async (c) =>
      ok(
        c,
        WorkTemplateCopyReceipt,
        await reconcileTemplateGalleryCopy(principal(c), c.req.valid('param').requestId),
      ),
  )
  .get(
    '/:bundleId',
    apiDoc({
      tag: 'Templates',
      summary: 'Reopen your saved work definitions',
      response: WorkTemplateCopyBundle,
    }),
    zParam(bundleParam),
    async (c) =>
      ok(
        c,
        WorkTemplateCopyBundle,
        await readTemplateGalleryCopyBundle(principal(c), c.req.valid('param').bundleId),
      ),
  )
  .post(
    '/:bundleId/undo',
    apiDoc({
      tag: 'Templates',
      summary: 'Undo one reviewed work-definition copy',
      response: WorkTemplateCopyUndoResult,
      description:
        'Reverse the actual saved aggregate receipt. Unused unchanged private copies are removed; publications preserve history, and changed or used copies remain recoverable. Existing work is preserved. Terminal replay requires the original active acceptor with View rights; installed reversal also requires current template authoring.',
    }),
    zParam(bundleParam),
    async (c) =>
      ok(
        c,
        WorkTemplateCopyUndoResult,
        await undoTemplateGalleryCopy(principal(c), c.req.valid('param').bundleId),
      ),
  );

export default copies;
