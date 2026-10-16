import { previewWorkTemplateArchive } from '../lib/templates/archive-impact';
import {
  WorkTemplateArchiveImpact,
  WorkTemplateArchiveImpactQuery,
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
import gallery from './work-template-gallery';
import blueprints from './work-template-blueprints';

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
  .route('/gallery', gallery)
  .route('/', identities)
  .route('/', blueprints)
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
    capabilityGuard('contribute', { sharedWorkMutation: false }),
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
    capabilityGuard('contribute', { sharedWorkMutation: false }),
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
    capabilityGuard('contribute', { sharedWorkMutation: false }),
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
  .get(
    '/:id/archive-impact',
    capabilityGuard('contribute', { sharedWorkMutation: false }),
    doc('Preview authorized template archive impact', WorkTemplateArchiveImpact),
    zParam(idParam),
    zQuery(WorkTemplateArchiveImpactQuery),
    async (c) =>
      ok(
        c,
        WorkTemplateArchiveImpact,
        await previewWorkTemplateArchive(
          c.get('actorCtx'),
          c.req.valid('param').id,
          c.req.valid('query'),
        ),
      ),
  )
  .post(
    '/:id/archive',
    capabilityGuard('contribute', { sharedWorkMutation: false }),
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
