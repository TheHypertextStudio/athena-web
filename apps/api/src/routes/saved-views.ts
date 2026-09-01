/**
 * `@docket/api` — saved-views router (mounted at `/v1/orgs/:orgId/saved-views`).
 */
import {
  actor,
  db,
  initiative,
  initiativeHierarchyLink,
  program,
  project,
  savedView,
  team,
  teamMember,
} from '@docket/db';
import {
  migrateLegacyTaskViewDefinition,
  legacyTaskNoMatchProjection,
  parseSavedWorkViewUpdate,
  projectTaskViewDefinitionToLegacy,
  projectTaskViewDefinitionToLegacyFallback,
  SavedViewCreate,
  SavedViewUpdate,
  SavedWorkViewCreate,
  SavedWorkViewOut,
  SavedWorkViewUpdate,
} from '@docket/work/saved-view-contract';
import {
  FractionalRank,
  TaskViewDefinition,
  type WorkViewContext,
} from '@docket/work/work-view-contract';
import { type Page, pageOf } from '../contracts/pagination';
import { and, eq, exists, or, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import type { JsonRoute } from '../lib/hono-rpc';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type SavedViewRow = typeof savedView.$inferSelect;

function toOut(v: SavedViewRow): z.input<typeof SavedWorkViewOut> {
  const legacy = legacyProjection(v.target, v.definition);
  return SavedWorkViewOut.parse({
    id: v.id,
    organizationId: v.organizationId,
    name: v.name,
    scope: v.scope,
    ownerActorId: v.ownerActorId,
    teamId: v.teamId,
    target: v.target,
    context: v.context,
    position: v.position,
    schemaVersion: 2,
    definition: v.definition,
    filters: legacy.filters,
    grouping: legacy.grouping,
    sort: legacy.sort,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  });
}

const idParam = z.object({ id: z.string() });
const savedViewCreateBody = z.union([SavedWorkViewCreate, SavedViewCreate.strict()]);
const savedViewUpdateBody = z.union([SavedWorkViewUpdate, SavedViewUpdate.strict()]);

/** Named RPC schema for legacy-compatible typed saved-view persistence. */
export type SavedViewRoutes = JsonRoute<
  'get',
  '/',
  Record<never, never>,
  Record<never, never>,
  Page<z.output<typeof SavedWorkViewOut>>
> &
  JsonRoute<
    'post',
    '/',
    { json: z.input<typeof savedViewCreateBody> },
    { json: z.output<typeof savedViewCreateBody> },
    z.output<typeof SavedWorkViewOut>
  > &
  JsonRoute<
    'get',
    '/:id',
    { param: z.input<typeof idParam> },
    { param: z.output<typeof idParam> },
    z.output<typeof SavedWorkViewOut>
  > &
  JsonRoute<
    'patch',
    '/:id',
    {
      param: z.input<typeof idParam>;
      json: z.input<typeof savedViewUpdateBody>;
    },
    {
      param: z.output<typeof idParam>;
      json: z.output<typeof savedViewUpdateBody>;
    },
    z.output<typeof SavedWorkViewOut>
  > &
  JsonRoute<
    'delete',
    '/:id',
    { param: z.input<typeof idParam> },
    { param: z.output<typeof idParam> },
    z.output<typeof SavedWorkViewOut>
  >;

function requestIssue(path: string, message: string): ValidationError {
  return new ValidationError([{ path: [path], message }]);
}

function migrateLegacy(input: {
  filters: z.infer<typeof SavedViewCreate>['filters'];
  grouping: z.infer<typeof SavedViewCreate>['grouping'];
  sort: z.infer<typeof SavedViewCreate>['sort'];
}) {
  try {
    return migrateLegacyTaskViewDefinition({
      filters: input.filters ?? [],
      grouping: input.grouping ?? null,
      sort: input.sort ?? [],
    });
  } catch {
    throw requestIssue('filters', 'The legacy Task view definition is not supported');
  }
}

async function assertSharing(
  organizationId: string,
  actorId: string,
  scope: 'personal' | 'team' | 'organization',
  ownerActorId: string | null,
  teamId: string | null,
): Promise<void> {
  if (scope === 'personal') {
    if (ownerActorId !== actorId) {
      throw requestIssue('ownerActorId', 'A personal view must belong to the current actor');
    }
    if (teamId !== null) throw requestIssue('teamId', 'A personal view cannot belong to a Team');
  } else if (scope === 'team') {
    if (ownerActorId !== null) {
      throw requestIssue('ownerActorId', 'A Team view cannot have a personal owner');
    }
    if (teamId === null) throw requestIssue('teamId', 'A team-shared view requires a Team');
  } else if (ownerActorId !== null || teamId !== null) {
    throw requestIssue(
      ownerActorId !== null ? 'ownerActorId' : 'teamId',
      'An organization view cannot have a personal owner or Team',
    );
  }
  if (ownerActorId !== null) {
    const owners = await db
      .select({ id: actor.id })
      .from(actor)
      .where(and(eq(actor.id, ownerActorId), eq(actor.organizationId, organizationId)))
      .limit(1);
    if (!owners[0]) throw new NotFoundError('Saved view owner not found');
  }
  if (teamId !== null) {
    const memberships = await db
      .select({ id: teamMember.teamId })
      .from(teamMember)
      .innerJoin(
        team,
        and(eq(team.id, teamMember.teamId), eq(team.organizationId, teamMember.organizationId)),
      )
      .where(
        and(
          eq(teamMember.teamId, teamId),
          eq(teamMember.actorId, actorId),
          eq(teamMember.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!memberships[0]) throw new NotFoundError('Saved view Team not found');
  }
}

function visibleSavedView(organizationId: string, actorId: string): SQL {
  const visibility = and(
    eq(savedView.organizationId, organizationId),
    or(
      eq(savedView.scope, 'organization'),
      and(eq(savedView.scope, 'personal'), eq(savedView.ownerActorId, actorId)),
      and(
        eq(savedView.scope, 'team'),
        exists(
          db
            .select({ one: teamMember.teamId })
            .from(teamMember)
            .innerJoin(
              team,
              and(
                eq(team.id, teamMember.teamId),
                eq(team.organizationId, savedView.organizationId),
              ),
            )
            .where(
              and(
                eq(teamMember.organizationId, savedView.organizationId),
                eq(teamMember.actorId, actorId),
                eq(teamMember.teamId, savedView.teamId),
              ),
            ),
        ),
      ),
    ),
  );
  if (!visibility) throw new TypeError('Saved-view visibility unexpectedly compiled empty.');
  return visibility;
}

type LegacyProjection = ReturnType<typeof projectTaskViewDefinitionToLegacyFallback>;

function legacyProjection(target: SavedViewRow['target'], definition: unknown): LegacyProjection {
  return target === 'task'
    ? projectTaskViewDefinitionToLegacyFallback(TaskViewDefinition.parse(definition))
    : legacyTaskNoMatchProjection();
}

async function assertContext(organizationId: string, context: WorkViewContext): Promise<void> {
  if (context.kind === 'organization') return;
  if (context.kind === 'initiative') {
    const rows = await db
      .select({ id: initiative.id })
      .from(initiative)
      .leftJoin(
        initiativeHierarchyLink,
        and(
          eq(initiativeHierarchyLink.contextOrganizationId, organizationId),
          or(
            eq(initiativeHierarchyLink.parentInitiativeId, initiative.id),
            eq(initiativeHierarchyLink.childInitiativeId, initiative.id),
          ),
        ),
      )
      .where(
        and(
          eq(initiative.id, context.initiativeId),
          or(
            eq(initiative.organizationId, organizationId),
            eq(initiativeHierarchyLink.contextOrganizationId, organizationId),
          ),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Saved view Initiative context not found');
    return;
  }
  const reference = {
    team: { table: team, id: context.kind === 'team' ? context.teamId : '' },
    project: { table: project, id: context.kind === 'project' ? context.projectId : '' },
    program: { table: program, id: context.kind === 'program' ? context.programId : '' },
  }[context.kind];
  const rows = await db
    .select({ id: reference.table.id })
    .from(reference.table)
    .where(
      and(eq(reference.table.id, reference.id), eq(reference.table.organizationId, organizationId)),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Saved view context not found');
}

/** Saved-views router: org-scoped CRUD over list/board configs; `contribute` to mutate. */
const savedViews: Hono<AppEnv, SavedViewRoutes> = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Views',
      summary: 'List saved views',
      response: pageOf(SavedWorkViewOut),
      description: `List the saved views visible to the caller. Organization views are visible to every member, Team views require current Team membership, and personal views are owner-only. The list is unpaginated and requires org membership (\`view\`). Returns a page wrapper of {@link SavedWorkViewOut}.`,
    }),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const rows = await db.select().from(savedView).where(visibleSavedView(orgId, actorId));
      return ok(c, pageOf(SavedWorkViewOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Views',
      summary: 'Create a saved view',
      capability: 'contribute',
      response: SavedWorkViewOut,
      description: `Create a saved view. Requires \`contribute\`. Only \`name\` is required; the rest default sensibly: \`scope\` defaults to \`personal\`, \`ownerActorId\` defaults to the calling actor, and \`filters\`/\`sort\` default to empty arrays (an unfiltered, unsorted view). \`grouping\` is optional (null = a flat list). \`organizationId\` is always derived from the path, never the body. Set \`scope\` to \`team\` (with \`teamId\`) or \`organization\` to share the view beyond yourself. Returns the created {@link SavedViewOut}.`,
    }),
    zJson(savedViewCreateBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const typed = 'target' in body;
      const scope = body.scope ?? 'personal';
      const ownerActorId = scope === 'personal' ? (body.ownerActorId ?? actorId) : null;
      const teamId = scope === 'team' ? (body.teamId ?? null) : null;
      const context = typed ? body.context : ({ kind: 'organization' } as const);
      const definition = typed
        ? body.definition
        : migrateLegacy({
            filters: body.filters,
            grouping: body.grouping,
            sort: body.sort,
          });
      await assertSharing(orgId, actorId, scope, ownerActorId, teamId);
      await assertContext(orgId, context);
      const legacy = typed ? legacyProjection(body.target, definition) : null;
      const values: typeof savedView.$inferInsert = {
        organizationId: orgId,
        name: body.name,
        scope,
        ownerActorId,
        teamId,
        target: typed ? body.target : 'task',
        context,
        position: FractionalRank.parse(typed ? body.position : 'a0'),
        schemaVersion: 2,
        definition,
        filters: typed ? (legacy?.filters ?? []) : (body.filters ?? []),
        grouping: typed ? (legacy?.grouping ?? null) : (body.grouping ?? null),
        sort: typed ? (legacy?.sort ?? []) : (body.sort ?? []),
        createdBy: actorId,
      };
      const inserted = await db.insert(savedView).values(values).returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('saved_view insert returned no row');
      await enqueueSearchUpsert(orgId, 'saved_view', row.id);
      return created(c, SavedWorkViewOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Views',
      summary: 'Get a saved view',
      response: SavedWorkViewOut,
      description: `Fetch one saved view by id, including its full \`filters\`, \`grouping\`, and \`sort\` config so a client can hydrate the view. The lookup is org-scoped, so a cross-org or unknown id 404s (\`Saved view not found\`). Requires org membership (\`view\`). Returns {@link SavedViewOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(savedView)
        .where(and(eq(savedView.id, id), visibleSavedView(orgId, actorId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Saved view not found');
      return ok(c, SavedWorkViewOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Views',
      summary: 'Update a saved view',
      capability: 'contribute',
      response: SavedWorkViewOut,
      description: `Partially update a saved view; only fields present in the body change (\`name\`, \`scope\`, \`ownerActorId\`, \`teamId\`, \`filters\`, \`grouping\`, \`sort\`). Requires \`contribute\`. \`filters\` and \`sort\` are replaced wholesale when supplied (not merged); \`grouping\` may be set to null to flatten the view; re-scoping (\`scope\`/\`ownerActorId\`/\`teamId\`) changes who the view is shared with. The lookup is org-scoped, so a cross-org/unknown id 404s. Returns the updated {@link SavedViewOut}.`,
    }),
    zParam(idParam),
    zJson(savedViewUpdateBody),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const currentRows = await db
        .select()
        .from(savedView)
        .where(and(eq(savedView.id, id), visibleSavedView(orgId, actorId)))
        .limit(1);
      const current = currentRows[0];
      if (!current) throw new NotFoundError('Saved view not found');
      const legacy = 'filters' in body || 'grouping' in body || 'sort' in body;
      if (legacy && current.target !== 'task') {
        throw requestIssue('filters', 'Legacy fields can update only Task saved views');
      }
      let currentTaskDefinition: z.infer<typeof TaskViewDefinition> | null = null;
      if (legacy) {
        try {
          currentTaskDefinition = TaskViewDefinition.parse(current.definition);
          projectTaskViewDefinitionToLegacy(currentTaskDefinition);
        } catch {
          throw requestIssue(
            'filters',
            'This saved view requires a current client before its filters can be changed',
          );
        }
      }
      const typed = legacy ? null : parseSavedWorkViewUpdate(current.target, body);
      const nextFilters = legacy && body.filters !== undefined ? body.filters : current.filters;
      const nextGrouping = legacy && body.grouping !== undefined ? body.grouping : current.grouping;
      const nextSort = legacy && body.sort !== undefined ? body.sort : current.sort;
      const migratedLegacy = legacy
        ? migrateLegacy({ filters: nextFilters, grouping: nextGrouping, sort: nextSort })
        : null;
      const nextDefinition =
        migratedLegacy && currentTaskDefinition
          ? TaskViewDefinition.parse({
              ...currentTaskDefinition,
              filter: migratedLegacy.filter,
              arrangement: migratedLegacy.arrangement,
            })
          : (typed?.definition ?? current.definition);
      const nextContext = typed?.context ?? current.context;
      const nextScope = typed?.scope ?? body.scope ?? current.scope;
      const ownerSupplied = body.ownerActorId !== undefined;
      const teamSupplied = body.teamId !== undefined;
      const nextOwner = ownerSupplied
        ? (body.ownerActorId ?? null)
        : nextScope === 'personal'
          ? current.scope === 'personal'
            ? current.ownerActorId
            : actorId
          : null;
      const nextTeam = teamSupplied
        ? (body.teamId ?? null)
        : nextScope === 'team' && current.scope === 'team'
          ? current.teamId
          : null;
      await assertSharing(orgId, actorId, nextScope, nextOwner, nextTeam);
      await assertContext(orgId, nextContext);
      const nextLegacy = legacyProjection(current.target, nextDefinition);
      const updated = await db
        .update(savedView)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          scope: nextScope,
          ownerActorId: nextOwner,
          teamId: nextTeam,
          context: nextContext,
          definition: nextDefinition,
          ...(typed?.position !== undefined ? { position: typed.position } : {}),
          filters: nextLegacy.filters,
          grouping: nextLegacy.grouping,
          sort: nextLegacy.sort,
        })
        .where(and(eq(savedView.id, id), eq(savedView.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Saved view not found');
      await enqueueSearchUpsert(orgId, 'saved_view', row.id);
      return ok(c, SavedWorkViewOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Views',
      summary: 'Delete a saved view',
      capability: 'contribute',
      response: SavedWorkViewOut,
      description: `Hard-delete a saved view. Requires \`contribute\`. The lookup is org-scoped, so a cross-org/unknown id 404s (\`Saved view not found\`). Like the labels delete, this returns the full deleted {@link SavedViewOut} row (not a bare acknowledgement) so the client can confirm exactly what was removed.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(savedView)
        .where(and(eq(savedView.id, id), visibleSavedView(orgId, actorId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Saved view not found');
      await enqueueSearchDelete(orgId, 'saved_view', row.id);
      return ok(c, SavedWorkViewOut, toOut(row));
    },
  );

export default savedViews;
