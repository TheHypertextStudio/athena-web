/**
 * `@docket/api` — templates router (mounted at `/v1/orgs/:orgId/templates`).
 *
 * @remarks
 * A template is a saved *starting point* for creating work, the create-side counterpart to a
 * saved view. The router is deliberately close to `./saved-views.ts` — same scope model, same
 * jsonb payload, same capability — with two departures worth knowing about:
 *
 * 1. The list read seeds the org's shipped defaults on first call. Existing workspaces therefore
 *    acquire their defaults the first time anyone opens a picker, with no migration backfill.
 * 2. Templates are not written to the search index. They are reached through the composer picker,
 *    the settings page, and the command palette; adding a `search_document_kind` member to make
 *    them findable a fourth way would widen an enum the schema explicitly asks callers not to
 *    widen casually.
 */
import { db, template } from '@docket/db';
import { CursorQuery, pageOf } from '../contracts/pagination';
import {
  TemplateCreate,
  TemplateOut,
  TemplateTargetType,
  TemplateUpdate,
} from '@docket/work/template-contract';
import { and, asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { seedDefaultTemplates } from '../lib/templates/defaults';
import { visibleTemplateWhere } from '../lib/templates/visibility';
import {
  createTemplate,
  reconcileTemplateImages,
  requireVisibleTemplate,
  toTemplateOut as toOut,
  updateTemplate,
} from '../lib/templates/write';
import { created, ok } from '../lib/ok';
import { pageResultById, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

const idParam = z.object({ id: z.string() });

const listQuery = CursorQuery.extend({
  targetType: TemplateTargetType.optional().describe(
    'Limit the list to templates that create this kind. Omit for every template in the org.',
  ),
});

/** Templates router: org-scoped CRUD over reusable create drafts; `contribute` to mutate. */
const templates = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'List templates',
      response: pageOf(TemplateOut),
      description: `List the templates visible to the caller: organization templates, their personal templates, and templates owned by teams they belong to. Results use stable template-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only with the same \`targetType\` filter. Visibility is applied before pagination. The first call seeds Docket's shipped defaults.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { targetType, cursor, limit } = c.req.valid('query');
      await seedDefaultTemplates(orgId, actorId);
      const rows = await db
        .select()
        .from(template)
        .where(
          and(
            visibleTemplateWhere(orgId, actorId, { targetType }),
            seekAfterId(template.id, cursor, 'asc'),
          ),
        )
        .orderBy(asc(template.id))
        .limit(limit + 1);
      return ok(c, pageOf(TemplateOut), pageResultById(rows.map(toOut), limit));
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Templates',
      summary: 'Create a template',
      capability: 'contribute',
      response: TemplateOut,
      description: `Create a template. Requires \`contribute\` — any contributing member may author one, including at \`organization\` scope. \`targetType\`, \`name\`, and \`payload\` are required; \`payload.targetType\` must equal \`targetType\` (422 otherwise). A personal template must belong to the calling actor, and a team template must name a team the caller belongs to. \`scope\` defaults to \`personal\` and \`ownerActorId\` to the calling actor. \`organizationId\` is always derived from the path, never the body. Returns the created {@link TemplateOut}.`,
    }),
    zJson(TemplateCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await createTemplate(orgId, actorId, c.req.valid('json'));
      return created(c, TemplateOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Templates',
      summary: 'Get a template',
      response: TemplateOut,
      description: `Fetch one caller-visible template by id, including its full \`payload\`, so a client can hydrate the template editor. Organization templates are visible to every member, personal templates only to their owner, and team templates only to team members. A hidden, cross-org, or unknown id 404s (\`Template not found\`). Requires org membership (\`view\`). Returns {@link TemplateOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      return ok(c, TemplateOut, toOut(await requireVisibleTemplate(orgId, actorId, id)));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Templates',
      summary: 'Update a template',
      capability: 'contribute',
      response: TemplateOut,
      description: `Partially update a caller-visible template; only fields present in the body change (\`name\`, \`description\`, \`scope\`, \`ownerActorId\`, \`teamId\`, \`payload\`). Requires \`contribute\`. \`payload\` is replaced wholesale when supplied, and its \`targetType\` must match the template's. A template cannot be moved into another actor's personal scope or a team the caller does not belong to. Moving \`scope\` away from \`team\` clears \`teamId\`. Shipped defaults can be edited, and those changes persist. A hidden, cross-workspace, or unknown id returns 404. Returns the updated {@link TemplateOut}.`,
    }),
    zParam(idParam),
    zJson(TemplateUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { after } = await updateTemplate(orgId, actorId, id, c.req.valid('json'));
      return ok(c, TemplateOut, toOut(after));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Templates',
      summary: 'Delete a template',
      capability: 'contribute',
      response: TemplateOut,
      description: `Delete a caller-visible template permanently. Requires \`contribute\`. A deleted shipped default does not return automatically. Docket seeds defaults only when a workspace has no templates. A hidden, cross-workspace, or unknown id returns 404. The response contains the deleted {@link TemplateOut} so the client can confirm or offer to restore it.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(template)
        .where(visibleTemplateWhere(orgId, actorId, { id }))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Template not found');
      await reconcileTemplateImages(orgId, row.id, 'delete');
      return ok(c, TemplateOut, toOut(row));
    },
  );

export default templates;
