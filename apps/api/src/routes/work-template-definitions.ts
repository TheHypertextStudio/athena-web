import {
  WorkTemplateCreate,
  WorkTemplateDraftUpdate,
  WorkTemplateListQuery,
  WorkTemplateOut,
  WorkTemplatePublish,
  WorkTemplateVersionOut,
} from '@docket/work/work-template-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { pageOf } from '../contracts/pagination';
import type { AppEnv } from '../context';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { toWorkTemplateOut, toWorkTemplateVersion } from '../lib/templates/projection';
import {
  archiveWorkTemplate,
  createWorkTemplate,
  editWorkTemplateDraft,
  getWorkTemplate,
  listWorkTemplates,
  listWorkTemplateVersions,
  publishWorkTemplate,
} from '../lib/templates/service';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import identities from './work-template-identities';

const idParam = z.object({ id: z.string() });
const doc = (summary: string, response: z.ZodType, status: 200 | 201 = 200) =>
  apiDoc({
    tag: 'Templates',
    summary,
    response,
    status,
  });

/** Revision-aware work-template definition and immutable publication routes. */
const definitions = new Hono<AppEnv>()
  .route('/', identities)
  .get(
    '/',
    doc('List work-template definitions', pageOf(WorkTemplateOut)),
    zQuery(WorkTemplateListQuery),
    async (c) => {
      const actor = c.get('actorCtx');
      const rows = await listWorkTemplates(actor, c.req.valid('query'));
      const items = await Promise.all(rows.map((row) => toWorkTemplateOut(actor, row)));
      return ok(c, pageOf(WorkTemplateOut), { items });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    doc('Create a work-template draft', WorkTemplateOut, 201),
    zJson(WorkTemplateCreate),
    async (c) => {
      const actor = c.get('actorCtx');
      return created(
        c,
        WorkTemplateOut,
        await toWorkTemplateOut(actor, await createWorkTemplate(actor, c.req.valid('json'))),
      );
    },
  )
  .get(
    '/:id',
    doc('Get a work-template definition', WorkTemplateOut),
    zParam(idParam),
    async (c) => {
      const actor = c.get('actorCtx');
      return ok(
        c,
        WorkTemplateOut,
        await toWorkTemplateOut(actor, await getWorkTemplate(actor, c.req.valid('param').id)),
      );
    },
  )
  .patch(
    '/:id/draft',
    capabilityGuard('contribute'),
    doc('Edit a work-template draft', WorkTemplateOut),
    zParam(idParam),
    zJson(WorkTemplateDraftUpdate),
    async (c) => {
      const actor = c.get('actorCtx');
      return ok(
        c,
        WorkTemplateOut,
        await toWorkTemplateOut(
          actor,
          await editWorkTemplateDraft(actor, c.req.valid('param').id, c.req.valid('json')),
        ),
      );
    },
  )
  .post(
    '/:id/publish',
    capabilityGuard('contribute'),
    doc('Publish a work-template revision', WorkTemplateOut),
    zParam(idParam),
    zJson(WorkTemplatePublish),
    async (c) => {
      const actor = c.get('actorCtx');
      return ok(
        c,
        WorkTemplateOut,
        await toWorkTemplateOut(
          actor,
          await publishWorkTemplate(
            actor,
            c.req.valid('param').id,
            c.req.valid('json').expectedRevision,
          ),
        ),
      );
    },
  )
  .get(
    '/:id/versions',
    doc('List immutable work-template versions', pageOf(WorkTemplateVersionOut)),
    zParam(idParam),
    async (c) => {
      const rows = await listWorkTemplateVersions(c.get('actorCtx'), c.req.valid('param').id);
      return ok(c, pageOf(WorkTemplateVersionOut), { items: rows.map(toWorkTemplateVersion) });
    },
  )
  .post(
    '/:id/archive',
    capabilityGuard('contribute'),
    doc('Archive a work-template definition', WorkTemplateOut),
    zParam(idParam),
    async (c) => {
      const actor = c.get('actorCtx');
      return ok(
        c,
        WorkTemplateOut,
        await toWorkTemplateOut(actor, await archiveWorkTemplate(actor, c.req.valid('param').id)),
      );
    },
  );

export default definitions;
