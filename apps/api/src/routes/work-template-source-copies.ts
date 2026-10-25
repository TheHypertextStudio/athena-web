import { Hono, type Context } from 'hono';
import {
  WorkTemplateSourceCopyAcceptRequest,
  WorkTemplateSourceCopyPreview,
  WorkTemplateSourceCopyPreviewRequest,
} from '@docket/work/template-copy';
import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { apiDoc } from '../lib/openapi-route';
import { ok } from '../lib/ok';
import { zJson } from '../lib/validate';
import {
  acceptTemplateSourceCopy,
  previewTemplateSourceCopy,
} from '../lib/template-gallery/source-preview';
import type { TemplateCopyPrincipal } from '../lib/templates/copy-reservation-context';
import { capabilityGuard } from '../permissions/capability-guard';
import { templateCopyReceiptRoutes } from './work-template-gallery-copies';

function principal(c: Context<AppEnv>): TemplateCopyPrincipal {
  const userId = c.get('principal')?.userId;
  if (!userId) throw new AuthError();
  return { organizationId: c.get('actorCtx').orgId, userId };
}
/** Manual source selection reuses canonical copy acceptance, saved bundle reentry and aggregate Undo. */
const sourceCopies = new Hono<AppEnv>()
  .use('*', capabilityGuard('view', { sharedWorkMutation: false }))
  .post(
    '/preview',
    apiDoc({
      tag: 'Templates',
      summary: 'Review independent copies of your work definitions',
      response: WorkTemplateSourceCopyPreview,
    }),
    zJson(WorkTemplateSourceCopyPreviewRequest),
    async (c) =>
      ok(
        c,
        WorkTemplateSourceCopyPreview,
        await previewTemplateSourceCopy(principal(c), c.req.valid('json')),
      ),
  )
  .post(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Keep reviewed independent work definitions',
      response: WorkTemplateCopyReceipt,
    }),
    zJson(WorkTemplateSourceCopyAcceptRequest),
    async (c) =>
      ok(
        c,
        WorkTemplateCopyReceipt,
        await acceptTemplateSourceCopy(principal(c), c.req.valid('json')),
      ),
  )
  .route('/', templateCopyReceiptRoutes);
export default sourceCopies;
