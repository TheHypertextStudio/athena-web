/** Directed calendar-item relationship routes. */
import { calendarItem, calendarItemRelation, db } from '@docket/db';
import {
  CalendarItemKind,
  CalendarItemRelationCreate,
  CalendarItemRelationOut,
} from '@docket/planning/calendar-contract';
import { pageOf } from '../contracts/pagination';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { resolveCanonicalCalendarItemSet } from '../calendar/calendar-read';

import { requireUserId } from './calendar-shared';

const idParam = z.object({ id: z.string() });
const itemRelationParam = z.object({ id: z.string(), relatedItemId: z.string() });
const CalendarItemRelationsOut = pageOf(CalendarItemRelationOut);

/**
 * Build a calendar-item relationship's wire shape WITHOUT validating `role` yet.
 *
 * @remarks
 * Two call sites need different failure behavior for the same raw row: a single-relation
 * response (POST/DELETE) should throw if its own role is somehow invalid, but the list endpoint
 * must not let one bad row take down every other relation in the response. Both build off this
 * shared, unvalidated shape and choose `.parse` vs `.safeParse` themselves.
 */
function toCalendarItemRelationOutUnsafe(
  row: typeof calendarItemRelation.$inferSelect,
  ids?: { readonly sourceItemId?: string; readonly targetItemId?: string },
): unknown {
  return {
    sourceItemId: ids?.sourceItemId ?? row.sourceItemId,
    targetItemId: ids?.targetItemId ?? row.targetItemId,
    role: row.role,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Serialize a user-owned calendar-item relationship, throwing if its role is unrecognized. */
function toCalendarItemRelationOut(
  row: typeof calendarItemRelation.$inferSelect,
): z.input<typeof CalendarItemRelationOut> {
  return CalendarItemRelationOut.parse(toCalendarItemRelationOutUnsafe(row));
}

/** Calendar-item relationship routes, mounted on the me-calendar router at `/`. */
export const calendarItemRelationRoutes = new Hono<AppEnv>()
  .post(
    '/items/:id/relations',
    apiDoc({
      status: 201,
      tag: 'Me',
      summary: 'Relate two calendar items',
      response: CalendarItemRelationOut,
      description:
        'Create a directed `contained` or `related` association between two calendar items owned by the signed-in user. Self-relations fail validation, foreign/missing items are existence-hidden as 404, and duplicate source-target pairs return a structured 409 conflict.',
    }),
    zParam(idParam),
    zJson(CalendarItemRelationCreate),
    async (c) => {
      const userId = requireUserId(c);
      const { id: requestedSourceItemId } = c.req.valid('param');
      const { targetItemId: requestedTargetItemId, role: relationRole } = c.req.valid('json');
      const [sourceSet, targetSet] = await Promise.all([
        resolveCanonicalCalendarItemSet(db, { userId, itemId: requestedSourceItemId }),
        resolveCanonicalCalendarItemSet(db, { userId, itemId: requestedTargetItemId }),
      ]);
      if (!sourceSet || !targetSet) throw new NotFoundError('Calendar item not found');
      const sourceItemId = sourceSet.canonicalItemId;
      const targetItemId = targetSet.canonicalItemId;
      if (sourceItemId === targetItemId) {
        throw new ValidationError([
          { path: ['targetItemId'], message: 'A calendar item cannot relate to itself' },
        ]);
      }

      const existing = await db
        .select({ sourceItemId: calendarItemRelation.sourceItemId })
        .from(calendarItemRelation)
        .where(
          and(
            inArray(calendarItemRelation.sourceItemId, [...sourceSet.memberItemIds]),
            inArray(calendarItemRelation.targetItemId, [...targetSet.memberItemIds]),
          ),
        )
        .limit(1);
      if (existing[0]) throw new ConflictError('Calendar items are already related');

      const rows = await db
        .insert(calendarItemRelation)
        .values({
          sourceItemId,
          targetItemId,
          role: relationRole,
          createdByUserId: userId,
        })
        .onConflictDoNothing()
        .returning();
      const relation = rows[0];
      if (!relation) throw new ConflictError('Calendar items are already related');
      return created(c, CalendarItemRelationOut, toCalendarItemRelationOut(relation));
    },
  )
  .get(
    '/items/:id/relations',
    apiDoc({
      tag: 'Me',
      summary: 'List calendar item relationships',
      response: CalendarItemRelationsOut,
      description:
        'List the directed contents and related calendar items attached to one caller-owned calendar item.',
    }),
    zParam(idParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const sourceSet = await resolveCanonicalCalendarItemSet(db, { userId, itemId: id });
      if (!sourceSet) throw new NotFoundError('Calendar item not found');
      const physicalRows = await db
        .select()
        .from(calendarItemRelation)
        .where(inArray(calendarItemRelation.sourceItemId, [...sourceSet.memberItemIds]));
      const rows = [
        ...new Map(
          physicalRows.map((row) => [`${row.targetItemId}\0${row.role}`, row] as const),
        ).values(),
      ];
      const targets =
        rows.length === 0
          ? []
          : await db
              .select({ id: calendarItem.id, title: calendarItem.title, kind: calendarItem.kind })
              .from(calendarItem)
              .where(
                and(
                  eq(calendarItem.userId, userId),
                  inArray(
                    calendarItem.id,
                    rows.map((row) => row.targetItemId),
                  ),
                ),
              );
      const targetById = new Map(targets.map((target) => [target.id, target]));
      return ok(c, CalendarItemRelationsOut, {
        // A single row that fails to parse (an unrecognized role, an unrecognized target kind)
        // is dropped rather than raising `.map()`'s error through the whole response — otherwise
        // one malformed relation makes every OTHER relation on this item unreadable too. Contrast
        // with the single-relation POST/DELETE responses below, which parse the one row they
        // return and correctly throw if it's invalid.
        items: rows.flatMap((row) => {
          const relation = CalendarItemRelationOut.safeParse(
            toCalendarItemRelationOutUnsafe(row, { sourceItemId: sourceSet.canonicalItemId }),
          );
          if (!relation.success) return [];
          const target = targetById.get(row.targetItemId);
          if (!target) return [relation.data];
          const targetKind = CalendarItemKind.safeParse(target.kind);
          if (!targetKind.success) return [relation.data];
          return [{ ...relation.data, targetTitle: target.title, targetKind: targetKind.data }];
        }),
      });
    },
  )
  .delete(
    '/items/:id/relations/:relatedItemId',
    apiDoc({
      tag: 'Me',
      summary: 'Remove a calendar item relationship',
      response: CalendarItemRelationOut,
      description:
        'Remove one directed calendar-item association and return the deleted relationship as a tombstone. Both items must be owned by the caller; a foreign item or missing relationship is existence-hidden as 404.',
    }),
    zParam(itemRelationParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id: requestedSourceItemId, relatedItemId: requestedTargetItemId } =
        c.req.valid('param');
      const [sourceSet, targetSet] = await Promise.all([
        resolveCanonicalCalendarItemSet(db, { userId, itemId: requestedSourceItemId }),
        resolveCanonicalCalendarItemSet(db, { userId, itemId: requestedTargetItemId }),
      ]);
      if (!sourceSet || !targetSet) {
        throw new NotFoundError('Calendar item relationship not found');
      }

      const rows = await db
        .delete(calendarItemRelation)
        .where(
          and(
            inArray(calendarItemRelation.sourceItemId, [...sourceSet.memberItemIds]),
            inArray(calendarItemRelation.targetItemId, [...targetSet.memberItemIds]),
          ),
        )
        .returning();
      const deleted = rows[0];
      if (!deleted) throw new NotFoundError('Calendar item relationship not found');
      return ok(
        c,
        CalendarItemRelationOut,
        CalendarItemRelationOut.parse(
          toCalendarItemRelationOutUnsafe(deleted, {
            sourceItemId: sourceSet.canonicalItemId,
            targetItemId: targetSet.canonicalItemId,
          }),
        ),
      );
    },
  );
