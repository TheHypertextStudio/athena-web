/**
 * `@docket/api` — saved-views router (mounted at `/v1/orgs/:orgId/saved-views`).
 */
import { db, savedView } from '@docket/db';
import { pageOf, SavedViewCreate, SavedViewOut, SavedViewUpdate } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type SavedViewRow = typeof savedView.$inferSelect;

function toOut(v: SavedViewRow): z.input<typeof SavedViewOut> {
  return {
    id: v.id,
    organizationId: v.organizationId,
    name: v.name,
    scope: v.scope,
    ownerActorId: v.ownerActorId,
    teamId: v.teamId,
    filters: v.filters,
    grouping: v.grouping ?? null,
    sort: v.sort,
    createdAt: v.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Saved-views router: org-scoped CRUD over list/board configs; `contribute` to mutate. */
const savedViews = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Views',
      summary: 'List saved views',
      response: pageOf(SavedViewOut),
      description: `List the org's saved views — reusable list/board configurations bundling a filter set, an optional grouping, and a sort order so a member can re-open a curated slice of work (e.g. "My open bugs, grouped by status"). Returns every view in the org regardless of \`scope\` (personal/team/organization); clients filter by scope and \`ownerActorId\` for presentation. The list is unpaginated. Requires org membership (\`view\`). Returns a page wrapper of {@link SavedViewOut}.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(savedView).where(eq(savedView.organizationId, orgId));
      return ok(c, pageOf(SavedViewOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Views',
      summary: 'Create a saved view',
      capability: 'contribute',
      response: SavedViewOut,
      description: `Create a saved view. Requires \`contribute\`. Only \`name\` is required; the rest default sensibly: \`scope\` defaults to \`personal\`, \`ownerActorId\` defaults to the calling actor, and \`filters\`/\`sort\` default to empty arrays (an unfiltered, unsorted view). \`grouping\` is optional (null = a flat list). \`organizationId\` is always derived from the path, never the body. Set \`scope\` to \`team\` (with \`teamId\`) or \`organization\` to share the view beyond yourself. Returns the created {@link SavedViewOut}.`,
    }),
    zJson(SavedViewCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const inserted = await db
        .insert(savedView)
        .values({
          organizationId: orgId,
          name: body.name,
          scope: body.scope ?? 'personal',
          ownerActorId: body.ownerActorId ?? actorId,
          teamId: body.teamId,
          filters: body.filters ?? [],
          grouping: body.grouping ?? null,
          sort: body.sort ?? [],
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('saved_view insert returned no row');
      await enqueueSearchUpsert(orgId, 'saved_view', row.id);
      return ok(c, SavedViewOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Views',
      summary: 'Get a saved view',
      response: SavedViewOut,
      description: `Fetch one saved view by id, including its full \`filters\`, \`grouping\`, and \`sort\` config so a client can hydrate the view. The lookup is org-scoped, so a cross-org or unknown id 404s (\`Saved view not found\`). Requires org membership (\`view\`). Returns {@link SavedViewOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(savedView)
        .where(and(eq(savedView.id, id), eq(savedView.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Saved view not found');
      return ok(c, SavedViewOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Views',
      summary: 'Update a saved view',
      capability: 'contribute',
      response: SavedViewOut,
      description: `Partially update a saved view; only fields present in the body change (\`name\`, \`scope\`, \`ownerActorId\`, \`teamId\`, \`filters\`, \`grouping\`, \`sort\`). Requires \`contribute\`. \`filters\` and \`sort\` are replaced wholesale when supplied (not merged); \`grouping\` may be set to null to flatten the view; re-scoping (\`scope\`/\`ownerActorId\`/\`teamId\`) changes who the view is shared with. The lookup is org-scoped, so a cross-org/unknown id 404s. Returns the updated {@link SavedViewOut}.`,
    }),
    zParam(idParam),
    zJson(SavedViewUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await db
        .update(savedView)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.scope !== undefined ? { scope: body.scope } : {}),
          ...(body.ownerActorId !== undefined ? { ownerActorId: body.ownerActorId } : {}),
          ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
          ...(body.filters !== undefined ? { filters: body.filters } : {}),
          ...(body.grouping !== undefined ? { grouping: body.grouping } : {}),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
        })
        .where(and(eq(savedView.id, id), eq(savedView.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Saved view not found');
      await enqueueSearchUpsert(orgId, 'saved_view', row.id);
      return ok(c, SavedViewOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Views',
      summary: 'Delete a saved view',
      capability: 'contribute',
      response: SavedViewOut,
      description: `Hard-delete a saved view. Requires \`contribute\`. The lookup is org-scoped, so a cross-org/unknown id 404s (\`Saved view not found\`). Like the labels delete, this returns the full deleted {@link SavedViewOut} row (not a bare acknowledgement) so the client can confirm exactly what was removed.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(savedView)
        .where(and(eq(savedView.id, id), eq(savedView.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Saved view not found');
      await enqueueSearchDelete(orgId, 'saved_view', row.id);
      return ok(c, SavedViewOut, toOut(row));
    },
  );

export default savedViews;
