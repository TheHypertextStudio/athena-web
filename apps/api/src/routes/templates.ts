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
import { db, teamMember, template } from '@docket/db';
import { pageOf } from '../contracts/pagination';
import {
  TemplateCreate,
  TemplateOut,
  TemplateTargetType,
  TemplateUpdate,
} from '@docket/work/template-contract';
import { and, eq, exists, or, sql } from 'drizzle-orm';
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

function visibleTemplateWhere(
  orgId: string,
  actorId: string,
  filters: {
    readonly id?: string | undefined;
    readonly targetType?: z.infer<typeof TemplateTargetType> | undefined;
  },
) {
  return and(
    eq(template.organizationId, orgId),
    filters.id === undefined ? undefined : eq(template.id, filters.id),
    filters.targetType === undefined ? undefined : eq(template.targetType, filters.targetType),
    or(
      eq(template.scope, 'organization'),
      and(eq(template.scope, 'personal'), eq(template.ownerActorId, actorId)),
      and(
        eq(template.scope, 'team'),
        exists(
          db
            .select({ one: sql`1` })
            .from(teamMember)
            .where(
              and(
                eq(teamMember.organizationId, orgId),
                eq(teamMember.actorId, actorId),
                eq(teamMember.teamId, template.teamId),
              ),
            ),
        ),
      ),
    ),
  );
}

async function requireAssignableScope(
  orgId: string,
  actorId: string,
  scope: TemplateRow['scope'],
  ownerActorId: string | null,
  teamId: string | null,
): Promise<void> {
  if (scope === 'personal' && ownerActorId !== actorId) {
    throw new ValidationError([
      {
        message: 'A personal template must belong to the calling actor.',
        path: ['ownerActorId'],
      },
    ]);
  }
  if (scope !== 'team') return;
  if (teamId === null) {
    throw new ValidationError([{ message: 'A team template requires a team.', path: ['teamId'] }]);
  }
  const membership = await db
    .select({ actorId: teamMember.actorId })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.organizationId, orgId),
        eq(teamMember.actorId, actorId),
        eq(teamMember.teamId, teamId),
      ),
    )
    .limit(1);
  if (!membership[0]) throw new NotFoundError('Team not found');
}

/** Templates router: org-scoped CRUD over reusable create drafts; `contribute` to mutate. */
const templates = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Templates',
      summary: 'List templates',
      response: pageOf(TemplateOut),
      description: `List the templates visible to the caller: organization templates, their personal templates, and templates owned by teams they belong to. Pass \`targetType\` to limit the list to one kind, which is what a create composer's picker does. Clients may narrow team templates further for the selected entity or composer context, but the API never returns another member's personal payload or a nonmember team's payload. The first call for an org installs Docket's shipped defaults as ordinary editable rows, so a workspace never sees an empty picker before it has authored anything. The list is unpaginated. Requires org membership (\`view\`). Returns a page wrapper of {@link TemplateOut}.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { targetType } = c.req.valid('query');
      await seedDefaultTemplates(orgId, actorId);
      const rows = await db
        .select()
        .from(template)
        .where(visibleTemplateWhere(orgId, actorId, { targetType }));
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
      description: `Create a template. Requires \`contribute\` — any contributing member may author one, including at \`organization\` scope. \`targetType\`, \`name\`, and \`payload\` are required; \`payload.targetType\` must equal \`targetType\` (422 otherwise). A personal template must belong to the calling actor, and a team template must name a team the caller belongs to. \`scope\` defaults to \`personal\` and \`ownerActorId\` to the calling actor. \`organizationId\` is always derived from the path, never the body. Returns the created {@link TemplateOut}.`,
    }),
    zJson(TemplateCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const scope = body.scope ?? 'personal';
      const ownerActorId = body.ownerActorId ?? actorId;
      const teamId = scope === 'team' ? (body.teamId ?? null) : null;
      await requireAssignableScope(orgId, actorId, scope, ownerActorId, teamId);
      const inserted = await db
        .insert(template)
        .values({
          organizationId: orgId,
          targetType: body.targetType,
          name: body.name,
          description: body.description,
          scope,
          ownerActorId,
          // A team id on a non-team-scoped template would be a reference nothing reads and
          // everything has to remember to ignore.
          teamId,
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
      description: `Fetch one caller-visible template by id, including its full \`payload\`, so a client can hydrate the template editor. Organization templates are visible to every member, personal templates only to their owner, and team templates only to team members. A hidden, cross-org, or unknown id 404s (\`Template not found\`). Requires org membership (\`view\`). Returns {@link TemplateOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(template)
        .where(visibleTemplateWhere(orgId, actorId, { id }))
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
      description: `Partially update a caller-visible template; only fields present in the body change (\`name\`, \`description\`, \`scope\`, \`ownerActorId\`, \`teamId\`, \`payload\`). Requires \`contribute\`. \`payload\` is replaced wholesale when supplied, and its \`targetType\` must match the template's — a template cannot change the kind it creates, because the stored draft would then describe a different entity (422). A template cannot be retargeted into another actor's personal scope or a team the caller does not belong to. Moving \`scope\` away from \`team\` clears \`teamId\`. A shipped default is an ordinary row here: editing one is allowed and permanent. A hidden, cross-org, or unknown id 404s. Returns the updated {@link TemplateOut}.`,
    }),
    zParam(idParam),
    zJson(TemplateUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const rows = await db
        .select()
        .from(template)
        .where(visibleTemplateWhere(orgId, actorId, { id }))
        .limit(1);
      const current = rows[0];
      if (!current) throw new NotFoundError('Template not found');

      const nextScope = body.scope ?? current.scope;
      const nextOwnerActorId =
        body.scope === 'personal'
          ? (body.ownerActorId ?? actorId)
          : (body.ownerActorId ?? current.ownerActorId);
      const nextTeamId = nextScope === 'team' ? (body.teamId ?? current.teamId) : null;
      await requireAssignableScope(orgId, actorId, nextScope, nextOwnerActorId, nextTeamId);

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
          ...(body.scope === 'personal'
            ? { ownerActorId: nextOwnerActorId }
            : body.ownerActorId !== undefined
              ? { ownerActorId: body.ownerActorId }
              : {}),
          // Applied after the scope reset above so a move *to* team scope keeps its new team.
          ...(body.teamId !== undefined && (body.scope ?? current.scope) === 'team'
            ? { teamId: body.teamId }
            : {}),
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
        })
        .where(visibleTemplateWhere(orgId, actorId, { id }))
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
      description: `Hard-delete a caller-visible template. Requires \`contribute\`. A shipped default deletes like any other row and does not come back: the defaults are seeded only when an org holds no template at all, so a workspace that clears one has cleared it. A hidden, cross-org, or unknown id 404s (\`Template not found\`). Returns the full deleted {@link TemplateOut} so the client can confirm exactly what was removed, and can offer to restore it.`,
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
      return ok(c, TemplateOut, toOut(row));
    },
  );

export default templates;
