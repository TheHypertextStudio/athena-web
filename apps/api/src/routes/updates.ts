/**
 * `@docket/api` — updates router (mounted at `/v1/orgs/:orgId/updates`).
 */
import { db, initiative, program, project, update } from '@docket/db';
import { pageOf, UpdateCreate, UpdateListQuery, UpdateOut } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type UpdateRow = typeof update.$inferSelect;

function toOut(u: UpdateRow): z.input<typeof UpdateOut> {
  return {
    id: u.id,
    organizationId: u.organizationId,
    authorId: u.authorId,
    subjectType: u.subjectType,
    subjectId: u.subjectId,
    health: u.health,
    body: u.body,
    createdAt: u.createdAt.toISOString(),
  };
}

/** The subject table whose `health` column an update of each subject type writes to. */
const subjectTable = { project, program, initiative } as const;

const idParam = z.object({ id: z.string() });

/**
 * Load a single Update scoped to the org, or throw {@link NotFoundError}.
 *
 * @remarks
 * The org filter is the tenant-isolation boundary: an id that belongs to another
 * organization reads as not-found rather than leaking its existence.
 *
 * @param orgId - The tenant the update must belong to.
 * @param id - The update id.
 * @returns the matching update row.
 * @throws {NotFoundError} When no update with that id exists in the org.
 */
async function loadUpdate(orgId: string, id: string): Promise<UpdateRow> {
  const rows = await db
    .select()
    .from(update)
    .where(and(eq(update.id, id), eq(update.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Update not found');
  return row;
}

/**
 * Updates router: list-by-subject + single-update detail + post.
 *
 * @remarks
 * Posting an update with a `health` also writes that value to the subject's current
 * `health` column (api-rpc-contract §3.9: "Latest update sets the subject's current
 * health"), keeping the Project/Program/Initiative health in sync with its newest post.
 */
const updates = new Hono<AppEnv>()
  .get('/', zQuery(UpdateListQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { subjectType, subjectId } = c.req.valid('query');
    const rows = await db
      .select()
      .from(update)
      .where(
        and(
          eq(update.organizationId, orgId),
          eq(update.subjectType, subjectType),
          eq(update.subjectId, subjectId),
        ),
      )
      .orderBy(desc(update.createdAt));
    return ok(c, pageOf(UpdateOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('contribute'), zJson(UpdateCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(update)
        .values({
          organizationId: orgId,
          authorId: actorId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          health: body.health,
          body: body.body,
          createdBy: actorId,
        })
        .returning();
      const created = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!created) throw new Error('update insert returned no row');

      if (body.health !== undefined) {
        const table = subjectTable[body.subjectType];
        await tx
          .update(table)
          .set({ health: body.health })
          .where(and(eq(table.id, body.subjectId), eq(table.organizationId, orgId)));
      }

      return created;
    });

    return ok(c, UpdateOut, toOut(row));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadUpdate(orgId, id);
    return ok(c, UpdateOut, toOut(row));
  });

export default updates;
