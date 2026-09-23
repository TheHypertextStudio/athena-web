/** Durable decisions about unfinished work from earlier days. */
import { dailyPlanItem, dailyPlanReview, db, hub } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';

const param = z.object({ date: z.iso.date() });
const decision = z.object({
  planItemId: z.string(),
  action: z.enum(['today', 'backlog', 'done', 'another']),
  targetDate: z.iso.date().optional(),
});
const input = z.object({ decisions: z.array(decision).max(100) });
const output = z.object({ reviewed: z.number().int().nonnegative() });

/** Save review decisions and any future day item in one transaction. */
async function persistReviewChoices(
  hubId: string,
  decisions: z.output<typeof decision>[],
  rows: (typeof dailyPlanItem.$inferSelect)[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of decisions) {
      const source = rows.find((row) => row.id === item.planItemId);
      if (!source) throw new NotFoundError('Earlier work not found');
      if (item.action === 'another' && item.targetDate) {
        const [existing] = await tx
          .select({ id: dailyPlanItem.id })
          .from(dailyPlanItem)
          .where(
            and(
              eq(dailyPlanItem.hubId, hubId),
              eq(dailyPlanItem.date, item.targetDate),
              eq(dailyPlanItem.refTaskId, source.refTaskId),
            ),
          )
          .limit(1);
        if (!existing)
          await tx.insert(dailyPlanItem).values({
            hubId,
            date: item.targetDate,
            refOrganizationId: source.refOrganizationId,
            refTaskId: source.refTaskId,
          });
      }
      await tx
        .insert(dailyPlanReview)
        .values({
          hubId,
          sourceItemId: source.id,
          decision: item.action,
          targetDate: item.targetDate ?? null,
        })
        .onConflictDoUpdate({
          target: dailyPlanReview.sourceItemId,
          set: {
            decision: item.action,
            targetDate: item.targetDate ?? null,
            reviewedAt: new Date(),
          },
        });
    }
  });
}

/** Record review choices and add future work without changing an accepted prior plan. */
const dailyPlanReviewRouter = new Hono<AppEnv>().post(
  '/day/:date/review',
  apiDoc({
    tag: 'DailyPlan',
    summary: 'Resolve unfinished earlier work',
    response: output,
    description:
      'Keep each review decision independently of accepted plan history. A future choice adds a new daily item.',
  }),
  zParam(param),
  zJson(input),
  async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { date } = c.req.valid('param');
    const { decisions } = c.req.valid('json');
    if (new Set(decisions.map((item) => item.planItemId)).size !== decisions.length) {
      throw new ValidationError([
        { path: ['decisions'], message: 'Each item can be reviewed once' },
      ]);
    }
    if (
      decisions.some(
        (item) => item.action === 'another' && (!item.targetDate || item.targetDate <= date),
      )
    ) {
      throw new ValidationError([{ path: ['decisions'], message: 'Choose a later date' }]);
    }
    const [person] = await db
      .select({ id: hub.id })
      .from(hub)
      .where(eq(hub.userId, session.user.id))
      .limit(1);
    if (!person) throw new NotFoundError('Hub not found');
    if (decisions.length === 0) return ok(c, output, { reviewed: 0 });
    const rows = await db
      .select()
      .from(dailyPlanItem)
      .where(
        and(
          eq(dailyPlanItem.hubId, person.id),
          inArray(
            dailyPlanItem.id,
            decisions.map((item) => item.planItemId),
          ),
        ),
      );
    if (rows.length !== decisions.length || rows.some((row) => row.date >= date)) {
      throw new NotFoundError('Earlier work not found');
    }
    const refs = rows.map((row) => ({
      id: row.refTaskId,
      organizationId: row.refOrganizationId,
      kind: 'task' as const,
    }));
    const access = await resolveResourceAccess(session.user.id, refs);
    if (refs.some((ref) => !access.get(resourceAccessKey(ref))?.canView)) {
      throw new NotFoundError('Earlier work not found');
    }
    await persistReviewChoices(person.id, decisions, rows);
    return ok(c, output, { reviewed: decisions.length });
  },
);

export default dailyPlanReviewRouter;
