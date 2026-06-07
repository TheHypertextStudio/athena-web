/**
 * `@docket/api` — cycles router (mounted at `/v1/orgs/:orgId/cycles`).
 */
import { cycle, db, team } from '@docket/db';
import { CycleCreate, CycleOut, CycleUpdate, pageOf } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type CycleRow = typeof cycle.$inferSelect;

function toOut(cy: CycleRow): z.input<typeof CycleOut> {
  return {
    id: cy.id,
    organizationId: cy.organizationId,
    teamId: cy.teamId,
    number: cy.number,
    name: cy.name,
    startsAt: cy.startsAt.toISOString(),
    endsAt: cy.endsAt.toISOString(),
    status: cy.status,
    createdAt: cy.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Cycles router: org-scoped CRUD; `contribute` to mutate. */
const cycles = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(cycle)
      .where(eq(cycle.organizationId, orgId))
      .orderBy(desc(cycle.startsAt));
    return ok(c, pageOf(CycleOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('contribute'), zJson(CycleCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const teamRows = await db
      .select()
      .from(team)
      .where(and(eq(team.id, body.teamId), eq(team.organizationId, orgId)))
      .limit(1);
    if (!teamRows[0]) throw new NotFoundError('Team not found');

    const inserted = await db
      .insert(cycle)
      .values({
        organizationId: orgId,
        teamId: body.teamId,
        number: body.number,
        name: body.name,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        status: body.status ?? 'upcoming',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('cycle insert returned no row');
    return ok(c, CycleOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Cycle not found');
    return ok(c, CycleOut, toOut(row));
  })
  .patch('/:id', capabilityGuard('contribute'), zParam(idParam), zJson(CycleUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const updated = await db
      .update(cycle)
      .set({
        ...(body.number !== undefined ? { number: body.number } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Cycle not found');
    return ok(c, CycleOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(cycle)
      .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Cycle not found');
    return ok(c, CycleOut, toOut(row));
  });

export default cycles;
