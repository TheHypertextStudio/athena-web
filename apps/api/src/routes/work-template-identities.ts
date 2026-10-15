import { TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateChoice, WorkTemplateDisplay } from '@docket/work/work-template-reference';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { getWorkTemplateDisplay, listWorkTemplateChoices } from '../lib/work-template-identities';
import { zParam, zQuery } from '../lib/validate';

/** Small published identity projections used by existing-work headers and change previews. */
const identities = new Hono<AppEnv>()
  .get(
    '/identities',
    apiDoc({
      tag: 'Templates',
      summary: 'List published template identity choices',
      response: pageOf(WorkTemplateChoice),
    }),
    zQuery(CursorQuery.extend({ targetType: TemplateTargetType, teamId: z.string().optional() })),
    async (c) => {
      const { targetType, teamId, cursor, limit } = c.req.valid('query');
      return ok(
        c,
        pageOf(WorkTemplateChoice),
        await listWorkTemplateChoices(c.get('actorCtx').orgId, targetType, teamId, {
          cursor,
          limit,
        }),
      );
    },
  )
  .get(
    '/:id/identity/:versionId',
    apiDoc({
      tag: 'Templates',
      summary: 'Get a pinned template identity',
      response: WorkTemplateDisplay,
    }),
    zParam(z.object({ id: z.string(), versionId: z.string() })),
    async (c) => {
      const { id, versionId } = c.req.valid('param');
      return ok(
        c,
        WorkTemplateDisplay,
        await getWorkTemplateDisplay(c.get('actorCtx').orgId, id, versionId),
      );
    },
  );

export default identities;
