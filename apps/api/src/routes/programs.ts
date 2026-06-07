/**
 * `@docket/api` — programs router (mounted at `/v1/orgs/:orgId/programs`).
 */
import { db, program } from '@docket/db';
import { pageOf, ProgramCreate, ProgramOut, ProgramUpdate } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type ProgramRow = typeof program.$inferSelect;

function toOut(p: ProgramRow): z.input<typeof ProgramOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    status: p.status,
    health: p.health,
    visibility: p.visibility,
    createdAt: p.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Programs router: org-scoped CRUD; `manage` to mutate. */
const programs = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(program)
      .where(eq(program.organizationId, orgId))
      .orderBy(desc(program.createdAt));
    return ok(c, pageOf(ProgramOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(ProgramCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
    const inserted = await db
      .insert(program)
      .values({
        organizationId: orgId,
        name: body.name,
        description: body.description,
        ownerId: body.ownerId,
        status: body.status ?? 'active',
        health: body.health,
        visibility: body.visibility ?? 'public',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('program insert returned no row');
    return ok(c, ProgramOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(program)
      .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Program not found');
    return ok(c, ProgramOut, toOut(row));
  })
  .patch('/:id', capabilityGuard('manage'), zParam(idParam), zJson(ProgramUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(program)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
      })
      .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Program not found');
    return ok(c, ProgramOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(program)
      .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Program not found');
    return ok(c, ProgramOut, toOut(row));
  });

export default programs;
