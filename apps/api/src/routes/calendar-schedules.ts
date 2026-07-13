/**
 * `@docket/api` — permission-safe workspace schedule comparison.
 *
 * @remarks
 * Mounted at `/v1/orgs/:orgId/calendar`. The organization router proves caller membership before
 * this router runs. Requested participants are independently constrained to active human actors in
 * that same organization. Personal calendar items enter the comparison only through explicit
 * {@link calendarLayerShare} rows; busy-only shares and private/busy provider items structurally
 * omit ids, kinds, and titles from the response.
 */
import { actor, calendarItem, calendarLayer, calendarLayerShare, db, hub } from '@docket/db';
import { CalendarItemKind, ScheduleComparisonOut, ScheduleComparisonQuery } from '@docket/types';
import type { ScheduleComparisonItemOut } from '@docket/types';
import { and, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';

/** Accept both one `actorIds` query value and the repeated-key array used for comparisons. */
const ScheduleComparisonHttpQuery = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const query = input as Record<string, unknown>;
  return {
    ...query,
    ...(typeof query['actorIds'] === 'string' ? { actorIds: [query['actorIds']] } : {}),
  };
}, ScheduleComparisonQuery);

/** Whether a provider snapshot marks an item private independently of the layer share. */
function isPrivateItem(providerRaw: Record<string, unknown> | null): boolean {
  return providerRaw?.['visibility'] === 'private' || providerRaw?.['private'] === true;
}

/** Convert an instant end bound to the exclusive calendar-date bound used by all-day rows. */
function allDayEndBound(end: string): string {
  const instant = new Date(end);
  const date = instant.toISOString().slice(0, 10);
  if (
    instant.getUTCHours() === 0 &&
    instant.getUTCMinutes() === 0 &&
    instant.getUTCSeconds() === 0 &&
    instant.getUTCMilliseconds() === 0
  ) {
    return date;
  }
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}

/** Convert one calendar row to the structurally redacted comparison union. */
function toScheduleItem(
  row: typeof calendarItem.$inferSelect,
  shareAccess: string,
): z.input<typeof ScheduleComparisonItemOut> {
  const time = {
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    allDayStartDate: row.allDayStartDate,
    allDayEndDate: row.allDayEndDate,
  };
  if (shareAccess !== 'details' || row.status === 'busy' || isPrivateItem(row.providerRaw)) {
    return { access: 'busy', ...time };
  }
  return {
    access: 'details',
    itemId: row.id,
    layerId: row.layerId,
    kind: CalendarItemKind.parse(row.kind),
    title: row.title,
    ...time,
  };
}

/** Workspace-calendar router. */
const calendarSchedules = new Hono<AppEnv>().get(
  '/schedules',
  apiDoc({
    tag: 'Calendar',
    summary: 'Compare workspace schedules',
    response: ScheduleComparisonOut,
    description:
      'Compare active workspace members over a bounded range. Only explicitly shared personal layers are included. Busy-only shares and private/busy items return time bounds alone; item ids, kinds, and titles are structurally omitted.',
  }),
  zQuery(ScheduleComparisonHttpQuery),
  async (c) => {
    const { orgId, actorId: callerActorId } = c.get('actorCtx');
    const query = c.req.valid('query');
    const requestedActorIds = [...new Set(query.actorIds)];
    if (requestedActorIds.length !== query.actorIds.length) {
      throw new ValidationError([
        { path: ['actorIds'], message: '`actorIds` must not contain duplicates' },
      ]);
    }

    const callerRows = await db
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.id, callerActorId),
          eq(actor.organizationId, orgId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
        ),
      )
      .limit(1);
    if (!callerRows[0]) throw new NotFoundError('Schedule participant not found');

    const peopleRows = await db
      .select({
        id: actor.id,
        displayName: actor.displayName,
        avatar: actor.avatar,
        userId: actor.userId,
      })
      .from(actor)
      .where(
        and(
          eq(actor.organizationId, orgId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
          inArray(actor.id, requestedActorIds),
        ),
      );
    if (peopleRows.length !== requestedActorIds.length) {
      throw new NotFoundError('Schedule participant not found');
    }

    const peopleById = new Map(peopleRows.map((person) => [person.id, person]));
    const userIds = peopleRows.flatMap((person) => (person.userId ? [person.userId] : []));
    const shareRows =
      userIds.length === 0
        ? []
        : await db
            .select({
              layerId: calendarLayerShare.layerId,
              access: calendarLayerShare.access,
              userId: calendarLayer.userId,
              timezone: calendarLayer.timezone,
            })
            .from(calendarLayerShare)
            .innerJoin(calendarLayer, eq(calendarLayer.id, calendarLayerShare.layerId))
            .where(
              and(
                eq(calendarLayerShare.organizationId, orgId),
                inArray(calendarLayer.userId, userIds),
              ),
            );

    const preferencesRows =
      userIds.length === 0
        ? []
        : await db
            .select({ userId: hub.userId, preferences: hub.preferences })
            .from(hub)
            .where(inArray(hub.userId, userIds));
    const timezoneByUserId = new Map(
      preferencesRows.flatMap((row) =>
        row.preferences.timezone ? [[row.userId, row.preferences.timezone] as const] : [],
      ),
    );
    for (const share of shareRows) {
      if (!timezoneByUserId.has(share.userId) && share.timezone) {
        timezoneByUserId.set(share.userId, share.timezone);
      }
    }

    const shareByLayerId = new Map(shareRows.map((share) => [share.layerId, share]));
    const layerIds = shareRows.map((share) => share.layerId);
    const start = new Date(query.start);
    const end = new Date(query.end);
    const startDate = query.start.slice(0, 10);
    const endDate = allDayEndBound(query.end);
    const itemRows =
      layerIds.length === 0
        ? []
        : await db
            .select()
            .from(calendarItem)
            .where(
              and(
                inArray(calendarItem.layerId, layerIds),
                isNull(calendarItem.archivedAt),
                ne(calendarItem.status, 'cancelled'),
                or(
                  and(lt(calendarItem.startsAt, end), gt(calendarItem.endsAt, start)),
                  and(
                    lt(calendarItem.allDayStartDate, endDate),
                    gt(calendarItem.allDayEndDate, startDate),
                  ),
                ),
              ),
            );

    const itemsByUserId = new Map<string, ReturnType<typeof toScheduleItem>[]>();
    for (const item of itemRows) {
      const share = shareByLayerId.get(item.layerId);
      /* v8 ignore next -- @preserve item query is constrained to shared layer ids */
      if (!share) continue;
      const items = itemsByUserId.get(share.userId) ?? [];
      items.push(toScheduleItem(item, share.access));
      itemsByUserId.set(share.userId, items);
    }
    for (const items of itemsByUserId.values()) {
      items.sort((left, right) =>
        (left.startsAt ?? left.allDayStartDate ?? '').localeCompare(
          right.startsAt ?? right.allDayStartDate ?? '',
        ),
      );
    }

    return ok(c, ScheduleComparisonOut, {
      start: query.start,
      end: query.end,
      people: requestedActorIds.map((actorId) => {
        const person = peopleById.get(actorId);
        /* v8 ignore next -- @preserve requested ids were proven by the scoped actor query */
        if (!person) throw new NotFoundError('Schedule participant not found');
        return {
          actorId,
          displayName: person.displayName,
          avatar: person.avatar,
          timezone: person.userId ? (timezoneByUserId.get(person.userId) ?? null) : null,
          items: person.userId ? (itemsByUserId.get(person.userId) ?? []) : [],
        };
      }),
    });
  },
);

export default calendarSchedules;
