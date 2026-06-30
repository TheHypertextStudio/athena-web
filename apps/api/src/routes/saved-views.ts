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
    apiDoc({ tag: 'Views', summary: 'List saved views', response: pageOf(SavedViewOut) }),
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
      return ok(c, SavedViewOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Views', summary: 'Get a saved view', response: SavedViewOut }),
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
      return ok(c, SavedViewOut, toOut(row));
    },
  );

export default savedViews;
