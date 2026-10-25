/** Optional saved-context tailoring uses existing authenticated Athena execution and Inbox. */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  TemplateTailoringSelection,
  TemplateTailoringRequest,
  TemplateTailoringPreview,
  TemplateTailoringSources,
  TemplateTailoringStatus,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { prepareTailoredRequest, saveTailoredRequest } from '../agent/template-tailoring';
import {
  deliverTailoredRequest,
  listTailoringSources,
  retryTailoredRequest,
  tailoringStatus,
} from '../agent/template-tailoring-delivery';
import type { TailoringCaller } from '../agent/template-tailoring-context';

function caller(c: Context<AppEnv>): TailoringCaller {
  const principal = c.get('principal');
  if (!principal) throw new NotFoundError();
  return { ...c.get('actorCtx'), userId: principal.userId };
}
const idParam = z.object({ id: z.ulid() });
const tailoring = new Hono<AppEnv>()
  .get(
    '/sources',
    apiDoc({
      tag: 'Templates',
      summary: 'Choose authorized saved context for Athena',
      response: TemplateTailoringSources,
    }),
    async (c) => ok(c, TemplateTailoringSources, await listTailoringSources(caller(c))),
  )
  .post(
    '/preview',
    apiDoc({
      tag: 'Templates',
      summary: 'Review the current saved context checkpoint',
      response: TemplateTailoringPreview,
    }),
    zJson(TemplateTailoringSelection),
    async (c) =>
      ok(c, TemplateTailoringPreview, await prepareTailoredRequest(caller(c), c.req.valid('json'))),
  )
  .post(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Request tailored starting work for private review',
      response: TemplateTailoringStatus,
    }),
    zJson(TemplateTailoringRequest),
    async (c) => {
      const identity = caller(c);
      const session = await saveTailoredRequest(identity, c.req.valid('json'));
      return ok(c, TemplateTailoringStatus, await deliverTailoredRequest(identity, session.id));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Templates',
      summary: 'Read the saved tailoring request and resulting reviews',
      response: TemplateTailoringStatus,
    }),
    zParam(idParam),
    async (c) =>
      ok(c, TemplateTailoringStatus, await tailoringStatus(caller(c), c.req.valid('param').id)),
  )
  .post(
    '/:id/retry',
    apiDoc({
      tag: 'Templates',
      summary: 'Retry a saved tailoring request',
      response: TemplateTailoringStatus,
    }),
    zParam(idParam),
    async (c) =>
      ok(
        c,
        TemplateTailoringStatus,
        await retryTailoredRequest(caller(c), c.req.valid('param').id),
      ),
  );
export default tailoring;
