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
import {
  pageOf,
  TemplateCreate,
  TemplateOut,
  TemplateTargetType,
  TemplateUpdate,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import { seedDefaultTemplates } from '../lib/templates/defaults';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type TemplateRow = typeof template.$inferSelect;

function toOut(t: TemplateRow): z.input<typeof TemplateOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    targetType: t.targetType,
    name: t.name,
    description: t.description,
    scope: t.scope,
    ownerActorId: t.ownerActorId,
    teamId: t.teamId,
    payload: t.payload,
    isSeed: t.isSeed,
    createdAt: t.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

const listQuery = z.object({
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
      description: `List the org's templates — reusable pre-filled drafts for creating a Task, Project, Initiative, or Program. Pass \`targetType\` to limit the list to one kind, which is what a create composer's picker does. Returns every template regardless of \`scope\` (personal/team/organization); clients filter by scope, \`ownerActorId\`, and \`teamId\` for presentation. The first call for an org installs Docket's shipped defaults as ordinary editable rows, so a workspace never sees an empty picker before it has authored anything. The list is unpaginated. Requires org membership (\`view\`). Returns a page wrapper of {@link TemplateOut}.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { targetType } = c.req.valid('query');
      await seedDefaultTemplates(orgId, actorId);
      const rows = await db
        .select()
        .from(template)
        .where(
          targetType
            ? and(eq(template.organizationId, orgId), eq(template.targetType, targetType))
            : eq(template.organizationId, orgId),
        );
      return ok(c, pageOf(TemplateOut), { items: rows.map(toOut) });
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
      description: `Create a template. Requires \`contribute\` — any contributing member may author one, including at \`organization\` scope. \`targetType\`, \`name\`, and \`payload\` are required; \`payload.targetType\` must equal \`targetType\` (422 otherwise) and \`scope: 'team'\` must name a \`teamId\` (422 otherwise). \`scope\` defaults to \`personal\` and \`ownerActorId\` to the calling actor. \`organizationId\` is always derived from the path, never the body. Returns the created {@link TemplateOut}.`,
    }),
    zJson(TemplateCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const scope = body.scope ?? 'personal';
      const inserted = await db
        .insert(template)
        .values({
          organizationId: orgId,
          targetType: body.targetType,
          name: body.name,
          description: body.description,
          scope,
          ownerActorId: body.ownerActorId ?? actorId,
          // A team id on a non-team-scoped template would be a reference nothing reads and
          // everything has to remember to ignore.
          teamId: scope === 'team' ? body.teamId : null,
          payload: body.payload,
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('template insert returned no row');
      return created(c, TemplateOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Templates',
      summary: 'Get a template',
      response: TemplateOut,
      description: `Fetch one template by id, including its full \`payload\`, so a client can hydrate the template editor. The lookup is org-scoped, so a cross-org or unknown id 404s (\`Template not found\`). Requires org membership (\`view\`). Returns {@link TemplateOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(template)
        .where(and(eq(template.id, id), eq(template.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Template not found');
      return ok(c, TemplateOut, toOut(row));
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
      description: `Partially update a template; only fields present in the body change (\`name\`, \`description\`, \`scope\`, \`ownerActorId\`, \`teamId\`, \`payload\`). Requires \`contribute\`. \`payload\` is replaced wholesale when supplied, and its \`targetType\` must match the template's — a template cannot change the kind it creates, because the stored draft would then describe a different entity (422). Moving \`scope\` away from \`team\` clears \`teamId\`. A shipped default is an ordinary row here: editing one is allowed and permanent. The lookup is org-scoped, so a cross-org/unknown id 404s. Returns the updated {@link TemplateOut}.`,
    }),
    zParam(idParam),
    zJson(TemplateUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const rows = await db
        .select()
        .from(template)
        .where(and(eq(template.id, id), eq(template.organizationId, orgId)))
        .limit(1);
      const current = rows[0];
      if (!current) throw new NotFoundError('Template not found');

      if (body.payload && body.payload.targetType !== current.targetType) {
        throw new ValidationError([
          {
            message: 'A template cannot change the kind it creates.',
            path: ['payload', 'targetType'],
          },
        ]);
      }

      const updated = await db
        .update(template)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.scope !== undefined ? { scope: body.scope, teamId: null } : {}),
          ...(body.ownerActorId !== undefined ? { ownerActorId: body.ownerActorId } : {}),
          // Applied after the scope reset above so a move *to* team scope keeps its new team.
          ...(body.teamId !== undefined && (body.scope ?? current.scope) === 'team'
            ? { teamId: body.teamId }
            : {}),
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
        })
        .where(and(eq(template.id, id), eq(template.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the select above proved the row exists */
      if (!row) throw new NotFoundError('Template not found');
      return ok(c, TemplateOut, toOut(row));
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
      description: `Hard-delete a template. Requires \`contribute\`. A shipped default deletes like any other row and does not come back: the defaults are seeded only when an org holds no template at all, so a workspace that clears one has cleared it. The lookup is org-scoped, so a cross-org/unknown id 404s (\`Template not found\`). Returns the full deleted {@link TemplateOut} so the client can confirm exactly what was removed, and can offer to restore it.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(template)
        .where(and(eq(template.id, id), eq(template.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Template not found');
      return ok(c, TemplateOut, toOut(row));
    },
  );

export default templates;
