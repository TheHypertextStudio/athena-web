/** Human-confirmed label conversion; draft review never changes work or labels. */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  LabelTemplateConversionChoices,
  LabelTemplateConversionConfirm,
  LabelTemplateConversionReview,
  LabelTemplateConversionReceipt,
} from '@docket/work/work-template-contract';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import {
  previewLabelTemplateConversion,
  confirmLabelTemplateConversion,
  reconcileLabelTemplateConversion,
} from '../lib/label-template-conversion/service';
import { undoLabelTemplateConversion } from '../lib/label-template-conversion/undo';
function reviewer(c: Context<AppEnv>) {
  const principal = c.get('principal');
  if (principal?.kind !== 'session') throw new NotFoundError();
  return {
    orgId: c.get('actorCtx').orgId,
    actorId: c.get('actorCtx').actorId,
    userId: principal.userId,
  };
}
const routes = new Hono<AppEnv>()
  .post(
    '/preview',
    apiDoc({
      tag: 'Templates',
      summary: 'Review selected label-to-template conversions',
      response: LabelTemplateConversionReview,
    }),
    zJson(LabelTemplateConversionChoices),
    async (c) =>
      ok(
        c,
        LabelTemplateConversionReview,
        await previewLabelTemplateConversion(reviewer(c), c.req.valid('json')),
      ),
  )
  .post(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Confirm the exact reviewed label conversions',
      response: LabelTemplateConversionReceipt,
    }),
    zJson(LabelTemplateConversionConfirm),
    async (c) =>
      ok(
        c,
        LabelTemplateConversionReceipt,
        await confirmLabelTemplateConversion(reviewer(c), c.req.valid('json')),
      ),
  )
  .post(
    '/requests/:requestId/undo',
    apiDoc({
      tag: 'Templates',
      summary: 'Undo an unchanged confirmed label conversion',
      response: LabelTemplateConversionReceipt,
    }),
    zParam(z.object({ requestId: z.uuid() })),
    async (c) =>
      ok(
        c,
        LabelTemplateConversionReceipt,
        await undoLabelTemplateConversion(reviewer(c), c.req.valid('param').requestId),
      ),
  )
  .get(
    '/requests/:requestId',
    apiDoc({
      tag: 'Templates',
      summary: 'Check a prior label conversion outcome',
      response: LabelTemplateConversionReceipt,
    }),
    zParam(z.object({ requestId: z.uuid() })),
    async (c) =>
      ok(
        c,
        LabelTemplateConversionReceipt,
        await reconcileLabelTemplateConversion(reviewer(c), c.req.valid('param').requestId),
      ),
  );
export default routes;
