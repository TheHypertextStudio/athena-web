/** Explicit labelled examples produce private reviews through the existing Athena session runner. */
import { Hono, type Context } from 'hono';
import {
  LabelTemplateSuggestionSelection,
  LabelTemplateSuggestionPreview,
  LabelTemplateSuggestionRequest,
  TemplateTailoringStatus,
  LabelTemplateSuggestionSources,
} from '@docket/work/template-gallery-contract';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import {
  prepareLabelTemplateSuggestion,
  saveLabelTemplateSuggestion,
} from '../agent/template-label-suggestions';
import { deliverTailoredRequest } from '../agent/template-tailoring-delivery';
import type { TailoringCaller } from '../agent/template-tailoring-context';
import { labelSuggestionSources } from '../agent/template-label-sources';

function caller(c: Context<AppEnv>): TailoringCaller {
  const principal = c.get('principal');
  if (!principal) throw new NotFoundError();
  return { ...c.get('actorCtx'), userId: principal.userId };
}
const suggestions = new Hono<AppEnv>()
  .get(
    '/sources',
    apiDoc({
      tag: 'Templates',
      summary: 'Choose authorized labels for template suggestions',
      response: LabelTemplateSuggestionSources,
    }),
    async (c) => ok(c, LabelTemplateSuggestionSources, await labelSuggestionSources(caller(c))),
  )
  .post(
    '/preview',
    apiDoc({
      tag: 'Templates',
      summary: 'Review selected labelled examples',
      response: LabelTemplateSuggestionPreview,
    }),
    zJson(LabelTemplateSuggestionSelection),
    async (c) =>
      ok(
        c,
        LabelTemplateSuggestionPreview,
        await prepareLabelTemplateSuggestion(caller(c), c.req.valid('json')),
      ),
  )
  .post(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'Request a private template suggestion from labelled examples',
      response: TemplateTailoringStatus,
    }),
    zJson(LabelTemplateSuggestionRequest),
    async (c) => {
      const identity = caller(c);
      const session = await saveLabelTemplateSuggestion(identity, c.req.valid('json'));
      return ok(c, TemplateTailoringStatus, await deliverTailoredRequest(identity, session.id));
    },
  );
export default suggestions;
