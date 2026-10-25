/** Checked Inbox template review; notification read state never authorizes a draft. */
import {
  TemplateProposalDecision,
  TemplateProposalReview,
} from '@docket/work/work-template-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import {
  decideTemplateProposal,
  getTemplateProposalReview,
} from '../agent/template-proposal-review';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import tailoring from './work-template-tailoring';
import labelSuggestions from './work-template-label-suggestions';

const param = z.object({ id: z.string() });
const proposals = new Hono<AppEnv>()
  .route('/tailoring', tailoring)
  .route('/label-suggestions', labelSuggestions)
  .get(
    '/:id',
    apiDoc({
      tag: 'Templates',
      summary: 'Review an Athena template proposal',
      response: TemplateProposalReview,
    }),
    zParam(param),
    async (c) => {
      const principal = c.get('principal');
      if (!principal) throw new NotFoundError();
      return ok(
        c,
        TemplateProposalReview,
        await getTemplateProposalReview(
          { ...c.get('actorCtx'), userId: principal.userId },
          c.req.valid('param').id,
        ),
      );
    },
  )
  .post(
    '/:id/decision',
    apiDoc({
      tag: 'Templates',
      summary: 'Keep, adjust, dismiss or undo a reviewed template',
      response: TemplateProposalReview,
    }),
    zParam(param),
    zJson(TemplateProposalDecision),
    async (c) => {
      const principal = c.get('principal');
      if (!principal) throw new NotFoundError();
      return ok(
        c,
        TemplateProposalReview,
        await decideTemplateProposal(
          { ...c.get('actorCtx'), userId: principal.userId },
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      );
    },
  );
export default proposals;
