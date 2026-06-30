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
  calendarList,
  db,
  task,
  team,
} from '@docket/db';
import {
  CalendarEventCreateTask,
  CalendarSettingsOut,
  CalendarListUpdate,
  CalendarSyncResultOut,
  TaskOut,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import { readCalendarSettings, requireUserId } from './calendar-shared';
import { syncGoogleCalendars } from './google-calendar-sync';
import { toOut } from './task-helpers';

const idParam = z.object({ id: z.string() });

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
      const updated = await db
        .update(calendarList)
        .set({
          ...(body.selected !== undefined ? { selected: body.selected } : {}),
          ...(body.visibleByDefault !== undefined
            ? { visibleByDefault: body.visibleByDefault }
            : {}),
        })
        .where(and(eq(calendarList.id, id), eq(calendarList.userId, userId)))
        .returning({ id: calendarList.id });
      if (!updated[0]) throw new NotFoundError('Calendar not found');
      return ok(c, CalendarSettingsOut, await readCalendarSettings(userId));
    },
  )
  .post(
    '/sync',
    apiDoc({
      tag: 'Me',
      summary: 'Sync Google Calendar',
      response: CalendarSyncResultOut,
      description:
        'Run a first-party Google Calendar sync. The scheduler and OAuth-backed fetcher use the same accounting shape.',
    }),
    async (c) => {
      const userId = requireUserId(c);
      return ok(c, CalendarSyncResultOut, await syncGoogleCalendars(userId));
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

      await db.insert(attachment).values({
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
      });

      return ok(c, TaskOut, toOut(created));
    },
  );

export default meCalendar;
