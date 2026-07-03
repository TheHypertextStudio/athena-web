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
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { emitEvent } from './event-emit';

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
  .get(
    '/',
    apiDoc({
      tag: 'Updates',
      summary: 'List updates',
      response: pageOf(UpdateOut),
      description: `List the status updates posted on one subject — a Project, Program, or Initiative — identified by the required \`subjectType\` and \`subjectId\` query params. An Update is a narrative status post that optionally carries a \`health\` signal (\`on_track | at_risk | off_track\`); the newest health-bearing post drives the subject's current health. Results are ordered newest-first. Scoped to the caller's org. Requires org membership (\`view\`). Returns a page wrapper of {@link UpdateOut}.`,
    }),
    zQuery(UpdateListQuery),
    async (c) => {
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
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Updates',
      summary: 'Post an update',
      capability: 'contribute',
      response: UpdateOut,
      description: `Post a status update on a Project, Program, or Initiative. Requires \`contribute\`. The author is the calling actor (from context, never the body). The required \`body\` is the narrative; \`health\` is optional.

Key side effect: when the post includes a \`health\`, the same transaction writes that value to the subject's own \`health\` column — "the latest update sets the subject's current health" (api-rpc-contract §3.9) — so the Project/Program/Initiative health stays in sync with its newest post. A post without \`health\` leaves the subject's current health untouched. The insert and the subject-health write are one transaction so a concurrent read never sees them diverge. Also emits a \`status_change\` observation on the subject (carrying \`health\` in its payload when set). Returns the created {@link UpdateOut}.`,
    }),
    zJson(UpdateCreate),
    async (c) => {
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

      // Stream: a posted status update surfaces on its subject (project/initiative/program).
      await emitEvent({
        organizationId: orgId,
        kind: 'status_change',
        actorId,
        title: 'Posted an update',
        summary: row.body,
        subject: { type: row.subjectType, id: row.subjectId },
        ...(row.health
          ? { detail: { schema: 'docket.state_change', fromState: null, toState: row.health } }
          : {}),
      });
      await enqueueSearchUpsert(orgId, 'update', row.id);
      await enqueueSearchUpsert(orgId, row.subjectType, row.subjectId);
      return ok(c, UpdateOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Updates',
      summary: 'Get an update',
      response: UpdateOut,
      description: `Fetch one status update by id. The org filter is the tenant-isolation boundary: an id belonging to another org reads as 404 (\`Update not found\`) rather than leaking its existence. Requires org membership (\`view\`). Returns {@link UpdateOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const row = await loadUpdate(orgId, id);
      return ok(c, UpdateOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Updates',
      summary: 'Delete an update',
      capability: 'contribute',
      response: UpdateRemoved,
      description: `Delete a status update. Requires \`contribute\` plus an authorship gate: a \`contribute\`-capable member may only delete their OWN update unless they hold \`manage\` (non-author without \`manage\` → 403). A cross-org/unknown id 404s.

Because the latest update drives the subject's current health, deletion is not a plain row removal: within one transaction the update is hard-deleted (the table has no soft-delete column) and the subject's \`health\` is recomputed from the newest *remaining* health-bearing update — older healthless posts are skipped, and when no health-bearing update remains the subject health is cleared to null. The single transaction guarantees a concurrent read never sees the row gone but the stale health still attached. Returns an {@link UpdateRemoved} acknowledgement.`,
    }),
    zParam(idParam),
    async (c) => {
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

      await enqueueSearchDelete(orgId, 'update', id);
      await enqueueSearchUpsert(orgId, existing.subjectType, existing.subjectId);
      return ok(c, UpdateRemoved, { id, removed: true });
    },
  );

export default updates;
