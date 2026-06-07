/**
 * `@docket/api` — updates router (mounted at `/v1/orgs/:orgId/updates`).
 */
import { type Capability, satisfies } from '@docket/authz';
import { db, initiative, program, project, update } from '@docket/db';
import { pageOf, UpdateCreate, UpdateListQuery, UpdateOut, UpdateRemoved } from '@docket/types';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError } from '../error';
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
 * Assert the caller may delete an Update they did not necessarily author.
 *
 * @remarks
 * Per api-rpc-contract §3.9 an Update is deletable by its **author** (the `contribute`
 * capability the route guard already required is not enough to delete someone else's
 * Update) OR by an actor holding `manage`. We compare the stored `authorId` to the
 * caller's `actorId`; a non-author without `manage` is `403`. Tenant isolation already
 * 404s a cross-org id in {@link loadUpdate}, so reaching here means the row is in-org.
 *
 * @param row - The org-scoped update row being deleted.
 * @param actorId - The calling actor's id.
 * @param held - The caller's org-level capabilities.
 * @throws {CapabilityError} When the caller is neither the author nor a `manage` holder.
 */
function assertAuthorOrManage(row: UpdateRow, actorId: string, held: readonly Capability[]): void {
  if (row.authorId === actorId) return;
  if (held.some((cap) => satisfies(cap, 'manage'))) return;
  throw new CapabilityError('Only the author can delete this update');
}

/**
 * Recompute a subject's current `health` from its remaining Updates after a delete.
 *
 * @remarks
 * api-rpc-contract §3.9: "Latest update sets the subject's current health". After
 * removing an Update we re-derive the subject health from the newest *remaining* Update
 * that carries a health (older healthless posts are skipped, matching POST which only
 * writes health when the post sets one). When no health-bearing Update remains the
 * subject health is cleared to `null`. Scoped to the org throughout for tenant isolation.
 *
 * @param tx - The active transaction.
 * @param orgId - The owning org.
 * @param subjectType - The deleted update's subject type.
 * @param subjectId - The deleted update's subject id.
 */
async function recomputeSubjectHealth(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  subjectType: UpdateRow['subjectType'],
  subjectId: string,
): Promise<void> {
  const remaining = await tx
    .select({ health: update.health })
    .from(update)
    .where(
      and(
        eq(update.organizationId, orgId),
        eq(update.subjectType, subjectType),
        eq(update.subjectId, subjectId),
      ),
    )
    .orderBy(desc(update.createdAt));
  // Newest remaining update that actually set a health wins; null when none remain.
  const latestHealth = remaining.find((r) => r.health !== null)?.health ?? null;
  const table = subjectTable[subjectType];
  await tx
    .update(table)
    .set({ health: latestHealth })
    .where(and(eq(table.id, subjectId), eq(table.organizationId, orgId)));
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
  })
  .delete('/:id', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId, actorId, capabilities } = c.get('actorCtx');
    const { id } = c.req.valid('param');

    // Authorship gate: a `contribute`-capable member may only delete their OWN update
    // unless they hold `manage`. Load first (404s a cross-org/unknown id) then check.
    const existing = await loadUpdate(orgId, id);
    assertAuthorOrManage(existing, actorId, capabilities as Capability[]);

    // Hard delete (the `update` table carries no soft-delete column), then recompute the
    // subject health from the newest remaining health-bearing update — in one transaction
    // so a concurrent read never sees the row gone but the stale health still attached.
    await db.transaction(async (tx) => {
      await tx.delete(update).where(and(eq(update.id, id), eq(update.organizationId, orgId)));
      await recomputeSubjectHealth(tx, orgId, existing.subjectType, existing.subjectId);
    });

    return ok(c, UpdateRemoved, { id, removed: true });
  });

export default updates;
