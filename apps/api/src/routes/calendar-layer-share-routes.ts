/** Workspace exposure routes for user-owned calendar layers. */
import { actor, calendarLayer, calendarLayerShare, db } from '@docket/db';
import {
  CalendarLayerShareAccess,
  CalendarLayerShareOut,
  CalendarLayerSharesReplace,
  pageOf,
} from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import { requireUserId } from './calendar-shared';

const organizationParam = z.object({ organizationId: z.string() });
const CalendarLayerSharesOut = pageOf(CalendarLayerShareOut);

/** Serialize one personal-layer exposure into an organization. */
function toCalendarLayerShareOut(
  row: typeof calendarLayerShare.$inferSelect,
): z.input<typeof CalendarLayerShareOut> {
  return {
    layerId: row.layerId,
    organizationId: row.organizationId,
    access: CalendarLayerShareAccess.parse(row.access),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Resolve the caller's active human Actor in a workspace, hiding non-membership. */
async function requireActiveOrgActor(userId: string, organizationId: string): Promise<string> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  const member = rows[0];
  if (!member) throw new NotFoundError('Workspace not found');
  return member.id;
}

/** User-owned calendar-layer sharing routes, mounted on the me-calendar router at `/`. */
export const calendarLayerShareRoutes = new Hono<AppEnv>()
  .get(
    '/shares/:organizationId',
    apiDoc({
      tag: 'Me',
      summary: 'List calendar layers shared with a workspace',
      response: CalendarLayerSharesOut,
      description:
        "List the caller's personal calendar layers currently exposed to one workspace. The caller must be an active human member of that workspace; non-membership is existence-hidden as 404.",
    }),
    zParam(organizationParam),
    async (c) => {
      const userId = requireUserId(c);
      const { organizationId } = c.req.valid('param');
      await requireActiveOrgActor(userId, organizationId);
      const rows = await db
        .select({ share: calendarLayerShare })
        .from(calendarLayerShare)
        .innerJoin(calendarLayer, eq(calendarLayer.id, calendarLayerShare.layerId))
        .where(
          and(
            eq(calendarLayerShare.organizationId, organizationId),
            eq(calendarLayer.userId, userId),
          ),
        );
      return ok(c, CalendarLayerSharesOut, {
        items: rows.map((row) => toCalendarLayerShareOut(row.share)),
      });
    },
  )
  .put(
    '/shares/:organizationId',
    apiDoc({
      tag: 'Me',
      summary: 'Replace calendar layers shared with a workspace',
      response: CalendarLayerSharesOut,
      description:
        "Atomically replace the caller's complete personal-layer exposure set for one workspace. Every requested layer must belong to the caller. An empty `shares` array revokes all of the caller's exposures without affecting shares owned by other members.",
    }),
    zParam(organizationParam),
    zJson(CalendarLayerSharesReplace),
    async (c) => {
      const userId = requireUserId(c);
      const { organizationId } = c.req.valid('param');
      const { shares } = c.req.valid('json');
      const actorId = await requireActiveOrgActor(userId, organizationId);
      const requestedLayerIds = shares.map((share) => share.layerId);
      if (new Set(requestedLayerIds).size !== requestedLayerIds.length) {
        throw new ValidationError([
          { path: ['shares'], message: '`shares` must not contain duplicate layer ids' },
        ]);
      }

      const replaced = await db.transaction(async (tx) => {
        const ownedRows =
          requestedLayerIds.length === 0
            ? []
            : await tx
                .select({ id: calendarLayer.id })
                .from(calendarLayer)
                .where(
                  and(
                    eq(calendarLayer.userId, userId),
                    inArray(calendarLayer.id, requestedLayerIds),
                  ),
                );
        if (ownedRows.length !== requestedLayerIds.length) {
          throw new NotFoundError('Calendar layer not found');
        }

        const existingRows = await tx
          .select({ layerId: calendarLayerShare.layerId })
          .from(calendarLayerShare)
          .innerJoin(calendarLayer, eq(calendarLayer.id, calendarLayerShare.layerId))
          .where(
            and(
              eq(calendarLayerShare.organizationId, organizationId),
              eq(calendarLayer.userId, userId),
            ),
          );
        if (existingRows.length > 0) {
          await tx.delete(calendarLayerShare).where(
            and(
              eq(calendarLayerShare.organizationId, organizationId),
              inArray(
                calendarLayerShare.layerId,
                existingRows.map((row) => row.layerId),
              ),
            ),
          );
        }

        if (shares.length === 0) return [];
        return tx
          .insert(calendarLayerShare)
          .values(
            shares.map((share) => ({
              layerId: share.layerId,
              organizationId,
              access: share.access,
              createdBy: actorId,
            })),
          )
          .returning();
      });

      return ok(c, CalendarLayerSharesOut, {
        items: replaced.map(toCalendarLayerShareOut),
      });
    },
  );
