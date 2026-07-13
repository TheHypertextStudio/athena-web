/** Directed calendar-item relationship routes. */
import { calendarItem, calendarItemRelation, db } from '@docket/db';
import {
  CalendarItemKind,
  CalendarItemRelationCreate,
  CalendarItemRelationOut,
  CalendarItemRelationRole,
  pageOf,
} from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import { requireUserId } from './calendar-shared';

const idParam = z.object({ id: z.string() });
const itemRelationParam = z.object({ id: z.string(), relatedItemId: z.string() });
const CalendarItemRelationsOut = pageOf(CalendarItemRelationOut);

/** Serialize a user-owned calendar-item relationship. */
function toCalendarItemRelationOut(
  row: typeof calendarItemRelation.$inferSelect,
): z.input<typeof CalendarItemRelationOut> {
  return {
    sourceItemId: row.sourceItemId,
    targetItemId: row.targetItemId,
    role: CalendarItemRelationRole.parse(row.role),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Calendar-item relationship routes, mounted on the me-calendar router at `/`. */
export const calendarItemRelationRoutes = new Hono<AppEnv>()
  .post(
    '/items/:id/relations',
    apiDoc({
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
      const { id: sourceItemId } = c.req.valid('param');
      const { targetItemId, role: relationRole } = c.req.valid('json');
      if (sourceItemId === targetItemId) {
        throw new ValidationError([
          { path: ['targetItemId'], message: 'A calendar item cannot relate to itself' },
        ]);
      }

      const itemRows = await db
        .select({ id: calendarItem.id })
        .from(calendarItem)
        .where(
          and(
            eq(calendarItem.userId, userId),
            inArray(calendarItem.id, [sourceItemId, targetItemId]),
          ),
        );
      if (new Set(itemRows.map((row) => row.id)).size !== 2) {
        throw new NotFoundError('Calendar item not found');
      }

      const existing = await db
        .select({ sourceItemId: calendarItemRelation.sourceItemId })
        .from(calendarItemRelation)
        .where(
          and(
            eq(calendarItemRelation.sourceItemId, sourceItemId),
            eq(calendarItemRelation.targetItemId, targetItemId),
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
      return ok(c, CalendarItemRelationOut, toCalendarItemRelationOut(relation));
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
      const owned = await db
        .select({ id: calendarItem.id })
        .from(calendarItem)
        .where(and(eq(calendarItem.id, id), eq(calendarItem.userId, userId)))
        .limit(1);
      if (!owned[0]) throw new NotFoundError('Calendar item not found');
      const rows = await db
        .select()
        .from(calendarItemRelation)
        .where(eq(calendarItemRelation.sourceItemId, id));
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
        items: rows.map((row) => {
          const relation = toCalendarItemRelationOut(row);
          const target = targetById.get(row.targetItemId);
          return target
            ? {
                ...relation,
                targetTitle: target.title,
                targetKind: CalendarItemKind.parse(target.kind),
              }
            : relation;
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
      const { id: sourceItemId, relatedItemId: targetItemId } = c.req.valid('param');
      const itemRows = await db
        .select({ id: calendarItem.id })
        .from(calendarItem)
        .where(
          and(
            eq(calendarItem.userId, userId),
            inArray(calendarItem.id, [sourceItemId, targetItemId]),
          ),
        );
      if (new Set(itemRows.map((row) => row.id)).size !== 2) {
        throw new NotFoundError('Calendar item relationship not found');
      }

      const rows = await db
        .delete(calendarItemRelation)
        .where(
          and(
            eq(calendarItemRelation.sourceItemId, sourceItemId),
            eq(calendarItemRelation.targetItemId, targetItemId),
          ),
        )
        .returning();
      const deleted = rows[0];
      if (!deleted) throw new NotFoundError('Calendar item relationship not found');
      return ok(c, CalendarItemRelationOut, toCalendarItemRelationOut(deleted));
    },
  );
