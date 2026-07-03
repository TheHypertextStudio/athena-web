/**
 * `@docket/api` — first-party Google Calendar settings router.
 *
 * @remarks
 * Mounted at `/v1/me/calendar`. This is intentionally user-scoped: linked Google
 * accounts and selected calendars belong to the Docket account, while tasks created
 * from events are native org tasks with a calendar-event attachment.
 */
import {
  actor,
  attachment,
  calendarConnection,
  calendarEvent,
  calendarItem,
  calendarItemTaskLink,
  calendarLayer,
  calendarList,
  db,
  task,
  team,
} from '@docket/db';
import {
  CalendarEventCreateTask,
  CalendarItemCreate,
  CalendarItemOut,
  CalendarItemsRangeOut,
  CalendarItemTaskLinkCreate,
  CalendarItemTaskLinkOut,
  CalendarItemTaskLinkResultOut,
  CalendarItemUpdate,
  CalendarLayerOut,
  CalendarLayersOut,
  CalendarLayerUpdate,
  CalendarRangeQuery,
  CalendarSettingsOut,
  CalendarListUpdate,
  CalendarSyncResultOut,
  TaskOut,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  countCalendarWriteState,
  drainDueCalendarItemWrites,
  retryCalendarItemWrite,
} from '../calendar/calendar-outbox';
import {
  readCalendarItemsInRange,
  readCalendarLayers,
  readItemDetail,
} from '../calendar/calendar-read';
import {
  toCalendarItemOut,
  toCalendarItemTaskLinkOut,
  toCalendarLayerOut,
} from '../calendar/calendar-serializers';
import { detachTaskFromItem, linkTaskToItem } from '../calendar/calendar-task-links';
import {
  createNativeBlock,
  deleteCalendarItem,
  updateCalendarItem,
} from '../calendar/calendar-write';
import type { AppEnv } from '../context';
import { NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { enqueueSearchUpsert } from '../search/write-through';

import { readCalendarSettings, requireUserId } from './calendar-shared';
import { syncCalendarConnections } from './calendar-sync-engine';
import { createDefaultCalendarSyncModules } from './calendar-sync-modules';
import { toOut } from './task-helpers';

const idParam = z.object({ id: z.string() });
const itemTaskParam = z.object({ id: z.string(), taskId: z.string() });

/**
 * Split a comma-separated query param into trimmed, non-empty parts, or `undefined` when
 * absent — the same CSV convention `agenda.ts` uses for `calendarIds`/`connectionIds`.
 */
function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Extract the `selected`/`visibleByDefault` fields common to both the legacy
 * `CalendarListUpdate` and the layered `CalendarLayerUpdate` bodies, for dual-writing
 * visibility changes across `calendar_list`/`calendar_layer` during the migration
 * window (their rows share ids per the Task 1 backfill).
 */
function toVisibilityPatch(body: {
  selected?: boolean;
  visibleByDefault?: boolean;
}): Partial<{ selected: boolean; visibleByDefault: boolean }> {
  const patch: Partial<{ selected: boolean; visibleByDefault: boolean }> = {};
  if (body.selected !== undefined) patch.selected = body.selected;
  if (body.visibleByDefault !== undefined) patch.visibleByDefault = body.visibleByDefault;
  return patch;
}

async function resolveTaskTarget(
  userId: string,
  body: z.infer<typeof CalendarEventCreateTask>,
): Promise<{ organizationId: string; teamId: string; actorId: string; state: string }> {
  const actorRows = await db
    .select({ id: actor.id, organizationId: actor.organizationId })
    .from(actor)
    .where(
      body.organizationId
        ? and(eq(actor.userId, userId), eq(actor.organizationId, body.organizationId))
        : eq(actor.userId, userId),
    )
    .limit(1);
  const member = actorRows[0];
  if (!member) throw new NotFoundError('Target workspace not found');

  const teamRows = await db
    .select()
    .from(team)
    .where(
      body.teamId
        ? and(eq(team.id, body.teamId), eq(team.organizationId, member.organizationId))
        : eq(team.organizationId, member.organizationId),
    )
    .limit(1);
  const targetTeam = teamRows[0];
  if (!targetTeam) throw new NotFoundError('Target team not found');

  return {
    organizationId: member.organizationId,
    teamId: targetTeam.id,
    actorId: member.id,
    state: targetTeam.workflowStates[0]?.key ?? 'backlog',
  };
}

const meCalendar = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Get Google Calendar settings',
      response: CalendarSettingsOut,
      description:
        'List first-party Google Calendar linked accounts and selectable calendars for the signed-in user. This nested settings surface keeps account/calendar configuration out of the top-level Connections list.',
    }),
    async (c) => ok(c, CalendarSettingsOut, await readCalendarSettings(requireUserId(c))),
  )
  .patch(
    '/calendars/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Update Google Calendar visibility',
      response: CalendarSettingsOut,
      description:
        'Update whether one Google calendar appears in agenda contexts by default, then return the full calendar settings payload.',
    }),
    zParam(idParam),
    zJson(CalendarListUpdate),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const visibilityPatch = toVisibilityPatch(body);
      const updated = await db
        .update(calendarList)
        .set(visibilityPatch)
        .where(and(eq(calendarList.id, id), eq(calendarList.userId, userId)))
        .returning({ id: calendarList.id });
      if (!updated[0]) throw new NotFoundError('Calendar not found');

      // Dual-write: `calendar_layer` ids reuse `calendar_list` ids from the Task 1
      // backfill, so mirror this visibility change onto `calendar_layer` (when a row
      // with this id exists) to keep the new layered-calendar reads coherent with this
      // legacy settings route during the migration window.
      await db
        .update(calendarLayer)
        .set(visibilityPatch)
        .where(and(eq(calendarLayer.id, id), eq(calendarLayer.userId, userId)));

      return ok(c, CalendarSettingsOut, await readCalendarSettings(userId));
    },
  )
  .get(
    '/layers',
    apiDoc({
      tag: 'Me',
      summary: 'List calendar layers',
      response: CalendarLayersOut,
      description:
        'List every calendar layer for the signed-in user — provider calendars, Docket-native blocks, task timeboxes, and availability — selected or not. Unlike the legacy calendar list, this includes non-provider layers.',
    }),
    async (c) =>
      ok(c, CalendarLayersOut, { items: await readCalendarLayers(db, requireUserId(c)) }),
  )
  .patch(
    '/layers/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Update a calendar layer',
      response: CalendarLayerOut,
      description:
        "Update a calendar layer's visibility (selected/visibleByDefault) for any owned layer. `title`/`color` are honored only for Docket-native layers (native blocks or availability with no backing connection) — a provider-backed layer rejects those fields.",
    }),
    zParam(idParam),
    zJson(CalendarLayerUpdate),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const existingRows = await db
        .select()
        .from(calendarLayer)
        .where(and(eq(calendarLayer.id, id), eq(calendarLayer.userId, userId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new NotFoundError('Calendar layer not found');

      const isNativeLayer =
        (existing.sourceKind === 'native_blocks' || existing.sourceKind === 'availability') &&
        existing.connectionId === null;
      if ((body.title !== undefined || body.color !== undefined) && !isNativeLayer) {
        throw new ValidationError(
          new z.ZodError([
            {
              code: 'custom',
              path: ['title'],
              message: 'title/color are only editable for Docket-native calendar layers',
              input: body,
            },
          ]),
        );
      }

      const patch: Partial<typeof calendarLayer.$inferInsert> = { ...toVisibilityPatch(body) };
      if (body.title !== undefined) patch.title = body.title;
      if (body.color !== undefined) patch.color = body.color;

      const updatedRows = await db
        .update(calendarLayer)
        .set(patch)
        .where(and(eq(calendarLayer.id, id), eq(calendarLayer.userId, userId)))
        .returning();
      const updated = updatedRows[0];
      if (!updated) throw new NotFoundError('Calendar layer not found');

      // Dual-write: a provider-backed layer's id reuses its originating `calendar_list`
      // row's id (Task 1 backfill), so mirror the visibility change onto `calendar_list`
      // (when a row with this id exists) to keep the legacy settings surface coherent
      // during the migration window. Native layers never collide with a `calendar_list`
      // id, so this is a safe no-op for them.
      const listVisibilityPatch = toVisibilityPatch(body);
      if (Object.keys(listVisibilityPatch).length > 0) {
        await db
          .update(calendarList)
          .set(listVisibilityPatch)
          .where(and(eq(calendarList.id, id), eq(calendarList.userId, userId)));
      }

      return ok(c, CalendarLayerOut, toCalendarLayerOut(updated));
    },
  )
  .post(
    '/sync',
    apiDoc({
      tag: 'Me',
      summary: 'Sync Google Calendar',
      response: CalendarSyncResultOut,
      description:
        'Run a first-party calendar sync across every linked provider account (currently Google) via the provider-neutral sync engine, then drain any provider-bound writes that are due for a backoff retry so a manual "Sync Now" also flushes the outbox.',
    }),
    async (c) => {
      const userId = requireUserId(c);
      const syncModules = createDefaultCalendarSyncModules();
      const pullResult = await syncCalendarConnections(db, { userId, adapters: syncModules });
      const now = new Date();
      const drainResult = await drainDueCalendarItemWrites(db, { userId, now, syncModules });
      const { writesPending, conflicts } = await countCalendarWriteState(db, userId);
      return ok(c, CalendarSyncResultOut, {
        ...pullResult,
        writesApplied: drainResult.applied,
        writesPending,
        conflicts,
      });
    },
  )
  .post(
    '/events/:id/create-task',
    apiDoc({
      tag: 'Me',
      summary: 'Create a task from a Google Calendar event',
      response: TaskOut,
      description:
        'Create a native Docket task from a cached Google Calendar event and attach the event as task context. The task can target an explicit workspace/team or fall back to the caller default membership.',
    }),
    zParam(idParam),
    zJson(CalendarEventCreateTask),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const rows = await db
        .select({ event: calendarEvent, calendar: calendarList, connection: calendarConnection })
        .from(calendarEvent)
        .innerJoin(calendarList, eq(calendarList.id, calendarEvent.calendarId))
        .innerJoin(calendarConnection, eq(calendarConnection.id, calendarEvent.connectionId))
        .where(and(eq(calendarEvent.id, id), eq(calendarEvent.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Calendar event not found');

      const target = await resolveTaskTarget(userId, body);
      const created = (
        await db
          .insert(task)
          .values({
            organizationId: target.organizationId,
            teamId: target.teamId,
            createdBy: target.actorId,
            title: body.title ?? row.event.title,
            description: body.note ?? row.event.description,
            state: target.state,
            priority: 'none',
            externalUrl: row.event.htmlLink,
          })
          .returning()
      )[0];
      if (!created) throw new Error('calendar event task insert returned no row');

      const insertedAttachments = await db
        .insert(attachment)
        .values({
          organizationId: target.organizationId,
          createdBy: target.actorId,
          subjectType: 'task',
          subjectId: created.id,
          kind: 'calendar_event',
          title: row.event.title,
          externalId: row.event.externalEventId,
          url: row.event.htmlLink,
          metadata: {
            connectionId: row.connection.id,
            calendarId: row.calendar.id,
            externalCalendarId: row.event.externalCalendarId,
            startsAt: row.event.startsAt?.toISOString() ?? null,
            endsAt: row.event.endsAt?.toISOString() ?? null,
            accountEmail: row.connection.accountEmail,
            calendarTitle: row.calendar.title,
          },
        })
        .returning({ id: attachment.id });
      const attachmentRow = insertedAttachments[0];
      if (!attachmentRow) throw new Error('calendar event attachment insert returned no row');

      await enqueueSearchUpsert(target.organizationId, 'task', created.id);
      await enqueueSearchUpsert(target.organizationId, 'attachment', attachmentRow.id);

      // Layered-calendar dual-write: `calendar_item` reuses `calendar_event`'s id from the
      // Task 1 backfill / Task 2 sync, so a `calendar_item` row should exist for any synced
      // event. If it is genuinely absent (pre-dual-write stale legacy data), skip the link
      // silently — the attachment above remains the source of truth for legacy rows.
      const itemRows = await db
        .select({
          id: calendarItem.id,
          title: calendarItem.title,
          startsAt: calendarItem.startsAt,
          endsAt: calendarItem.endsAt,
        })
        .from(calendarItem)
        .where(eq(calendarItem.id, id))
        .limit(1);
      const itemRow = itemRows[0];
      if (itemRow !== undefined) {
        await db.insert(calendarItemTaskLink).values({
          calendarItemId: itemRow.id,
          taskId: created.id,
          organizationId: target.organizationId,
          createdBy: target.actorId,
          role: 'related',
          sort: 0,
          itemTitleSnapshot: itemRow.title,
          itemStartsAtSnapshot: itemRow.startsAt,
          itemEndsAtSnapshot: itemRow.endsAt,
        });
      }

      return ok(c, TaskOut, toOut(created));
    },
  )
  .post(
    '/items',
    apiDoc({
      tag: 'Me',
      summary: 'Create a native calendar block',
      response: CalendarItemOut,
      description:
        "Create a Docket-native calendar block (focus, travel, do-not-schedule, holds) with no provider account required. `layerId` targets one of the caller's own native-block layers; omitted, the block is filed on the caller's default native-blocks layer, created lazily on first use.",
    }),
    zJson(CalendarItemCreate),
    async (c) => {
      const userId = requireUserId(c);
      const body = c.req.valid('json');
      const created = await createNativeBlock(db, { userId, input: body });
      return ok(c, CalendarItemOut, toCalendarItemOut(created, { linkedTasks: [] }));
    },
  )
  .get(
    '/items',
    apiDoc({
      tag: 'Me',
      summary: 'List calendar items in a range',
      response: CalendarItemsRangeOut,
      description:
        "List every calendar item overlapping `[start, end)` across the caller's selected layers, plus the layers that selection touches. `layerIds`/`kinds` are comma-separated optional filters, matching the `/v1/agenda` CSV convention.",
    }),
    async (c) => {
      const userId = requireUserId(c);
      const query = CalendarRangeQuery.parse({
        start: c.req.query('start'),
        end: c.req.query('end'),
        layerIds: splitCsv(c.req.query('layerIds')),
        kinds: splitCsv(c.req.query('kinds')),
      });
      const result = await readCalendarItemsInRange(db, {
        userId,
        start: new Date(query.start),
        end: new Date(query.end),
        layerIds: query.layerIds,
        kinds: query.kinds,
      });
      return ok(c, CalendarItemsRangeOut, result);
    },
  )
  .get(
    '/items/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Get a calendar item',
      response: CalendarItemOut,
      description:
        "Get one calendar item with its resolved edit/delete permissions and viewer-filtered linked tasks. Resolves even when the item's layer is currently deselected (a deep link should still work). 404 when the item does not exist or is not owned by the caller.",
    }),
    zParam(idParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const detail = await readItemDetail(db, { userId, itemId: id });
      if (detail === null) throw new NotFoundError('Calendar item not found');
      return ok(c, CalendarItemOut, detail);
    },
  )
  .patch(
    '/items/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Update a calendar item',
      response: CalendarItemOut,
      description:
        "Patch a calendar item's core fields (title, description, location, timezone, time bounds). `native_block` items apply directly; `provider_event` items apply locally and push to the provider (foreground attempt), returning a fresh `syncState`; `task_timebox`/`availability_block` items reject edits (422, derived views). An empty string for `description`/`location` clears the field. Changing the time shape (timed <-> all-day) requires the complete new shape's fields. 404 when the item does not exist or is not owned by the caller; 403 when a `provider_event` edit lacks the required scope/role/capability; 409 when the item has an unresolved conflict.",
    }),
    zParam(idParam),
    zJson(CalendarItemUpdate),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await updateCalendarItem(db, {
        userId,
        itemId: id,
        patch: body,
        syncModules: createDefaultCalendarSyncModules(),
      });
      const detail = await readItemDetail(db, { userId, itemId: id });
      /* v8 ignore next -- @preserve defensive: the update above verified the item exists */
      if (detail === null) throw new NotFoundError('Calendar item not found');
      return ok(c, CalendarItemOut, detail);
    },
  )
  .delete(
    '/items/:id',
    apiDoc({
      tag: 'Me',
      summary: 'Delete a calendar item',
      response: CalendarItemOut,
      description:
        'Delete a calendar item and return its representation as a tombstone. `native_block` items hard-delete immediately (task links removed by cascade). `provider_event` items push a delete to the provider (foreground attempt) and only archive locally once the provider confirms it; other outcomes leave the item visible with an updated `syncState`. `task_timebox`/`availability_block` items reject deletion (422, derived views). 404 when the item does not exist or is not owned by the caller; 403 when a `provider_event` delete lacks the required scope/role/capability; 409 when the item has an unresolved conflict.',
    }),
    zParam(idParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const deleted = await deleteCalendarItem(db, {
        userId,
        itemId: id,
        syncModules: createDefaultCalendarSyncModules(),
      });
      return ok(c, CalendarItemOut, toCalendarItemOut(deleted, { linkedTasks: [] }));
    },
  )
  .post(
    '/items/:id/retry-write',
    apiDoc({
      tag: 'Me',
      summary: 'Retry a provider write with local changes',
      response: CalendarItemOut,
      description:
        "Retry a `provider_event` item's failed or conflicted outbox write, keeping the local (pending) changes rather than discarding them. When the item is in `conflict`, re-anchors the write to the provider snapshot captured at conflict time and reattempts in the foreground; without a usable snapshot, the write is marked permanently failed with a clear error. 404 when the item does not exist, is not owned by the caller, or has no retryable write; 409 when the item is not in a retryable state.",
    }),
    zParam(idParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      await retryCalendarItemWrite(db, {
        userId,
        itemId: id,
        syncModules: createDefaultCalendarSyncModules(),
      });
      const detail = await readItemDetail(db, { userId, itemId: id });
      /* v8 ignore next -- @preserve defensive: the retry above verified the item exists */
      if (detail === null) throw new NotFoundError('Calendar item not found');
      return ok(c, CalendarItemOut, detail);
    },
  )
  .post(
    '/items/:id/tasks',
    apiDoc({
      tag: 'Me',
      summary: 'Link a task to a calendar item',
      response: CalendarItemTaskLinkResultOut,
      description:
        "Link an existing task to a calendar item (`mode: 'link'`), or create a new task and link it (`mode: 'create'`). The calendar item must be owned by the caller, and the caller must have an actor holding the `contribute` capability in the target org. `mode: 'link'` 404s when the task does not exist in that org or is not visible to the caller (existence-hiding), and 409s when the task is already linked to this item. `mode: 'create'` resolves the target team the same way the legacy `POST /events/:id/create-task` route does, deriving the title from the item's title when omitted.",
    }),
    zParam(idParam),
    zJson(CalendarItemTaskLinkCreate),
    async (c) => {
      const userId = requireUserId(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const { link, task: linkedTask } = await linkTaskToItem(db, {
        userId,
        itemId: id,
        input: body,
      });
      return ok(c, CalendarItemTaskLinkResultOut, {
        link: toCalendarItemTaskLinkOut(link),
        task: toOut(linkedTask),
      });
    },
  )
  .delete(
    '/items/:id/tasks/:taskId',
    apiDoc({
      tag: 'Me',
      summary: 'Detach a task from a calendar item',
      response: CalendarItemTaskLinkOut,
      description:
        "Remove the link between a calendar item and a task, returning the deleted link as a tombstone. The task itself is never deleted. 404 when the item is not owned by the caller or no such link exists; 403 when the caller's actor in the link's org lacks `contribute`.",
    }),
    zParam(itemTaskParam),
    async (c) => {
      const userId = requireUserId(c);
      const { id, taskId } = c.req.valid('param');
      const deleted = await detachTaskFromItem(db, { userId, itemId: id, taskId });
      return ok(c, CalendarItemTaskLinkOut, toCalendarItemTaskLinkOut(deleted));
    },
  );

export default meCalendar;
