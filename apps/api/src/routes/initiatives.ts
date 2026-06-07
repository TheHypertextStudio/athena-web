/**
 * `@docket/api` — initiatives router (mounted at `/v1/orgs/:orgId/initiatives`).
 */
import { db, initiative } from '@docket/db';
import { InitiativeCreate, InitiativeOut, InitiativeUpdate, pageOf } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type InitiativeRow = typeof initiative.$inferSelect;

function toOut(i: InitiativeRow): z.input<typeof InitiativeOut> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    name: i.name,
    description: i.description,
    ownerId: i.ownerId,
    status: i.status,
    targetDate: i.targetDate?.toISOString() ?? null,
    health: i.health,
    createdAt: i.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Initiatives router: org-scoped CRUD; `manage` to mutate. */
const initiatives = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(initiative)
      .where(eq(initiative.organizationId, orgId))
      .orderBy(desc(initiative.createdAt));
    return ok(c, pageOf(InitiativeOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(InitiativeCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
    const inserted = await db
      .insert(initiative)
      .values({
        organizationId: orgId,
        name: body.name,
        description: body.description,
        ownerId: body.ownerId,
        status: body.status ?? 'active',
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        health: body.health,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('initiative insert returned no row');
    return ok(c, InitiativeOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(initiative)
      .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Initiative not found');
    return ok(c, InitiativeOut, toOut(row));
  })
  .patch('/:id', capabilityGuard('manage'), zParam(idParam), zJson(InitiativeUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(initiative)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
          : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
      })
      .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Initiative not found');
    return ok(c, InitiativeOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(initiative)
      .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Initiative not found');
    return ok(c, InitiativeOut, toOut(row));
  });

export default initiatives;
