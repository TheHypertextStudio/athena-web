/**
 * `@docket/api` — labels router (mounted at `/v1/orgs/:orgId/labels`).
 */
import { db, label } from '@docket/db';
import { LabelCreate, LabelOut, LabelUpdate, pageOf } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type LabelRow = typeof label.$inferSelect;

function toOut(l: LabelRow): z.input<typeof LabelOut> {
  return {
    id: l.id,
    organizationId: l.organizationId,
    name: l.name,
    color: l.color,
    group: l.group,
    teamId: l.teamId,
    createdAt: l.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Labels router: org-scoped CRUD (org-global or team-scoped); `contribute` to mutate. */
const labels = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({ tag: 'Labels', summary: 'List labels', response: pageOf(LabelOut) }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(label).where(eq(label.organizationId, orgId));
      return ok(c, pageOf(LabelOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Create a label',
      capability: 'contribute',
      response: LabelOut,
    }),
    zJson(LabelCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const inserted = await db
        .insert(label)
        .values({
          organizationId: orgId,
          name: body.name,
          color: body.color,
          group: body.group ?? null,
          teamId: body.teamId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('label insert returned no row');
      return ok(c, LabelOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Labels', summary: 'Get a label', response: LabelOut }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(label)
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Label not found');
      return ok(c, LabelOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Update a label',
      capability: 'contribute',
      response: LabelOut,
    }),
    zParam(idParam),
    zJson(LabelUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await db
        .update(label)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.group !== undefined ? { group: body.group } : {}),
          ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        })
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Label not found');
      return ok(c, LabelOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Delete a label',
      capability: 'contribute',
      response: LabelOut,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(label)
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Label not found');
      return ok(c, LabelOut, toOut(row));
    },
  );

export default labels;
