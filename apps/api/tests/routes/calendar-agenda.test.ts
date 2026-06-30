import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AgendaOut, CalendarSettingsOut, TaskOut } from '@docket/types';

import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
} from './harness.test';

let calendarRouter: unknown;
let agendaRouter: unknown;

async function body<T>(res: Response): Promise<T> {
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seedCalendarFixture() {
  const schema = await getDb();
  const userId = await seedUserWithHub(schema.db, schema, 'CalendarUser');
  const base = await seedBaseOrg(schema.db, schema);
  await schema.db
    .update(schema.actor)
    .set({ userId })
    .where(eq(schema.actor.id, base.humanActorId));

  const task = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        title: 'Plan the calendar rollout',
        state: 'todo',
        priority: 'high',
      })
      .returning({ id: schema.task.id }),
  );
  await schema.db.insert(schema.dailyPlanItem).values({
    hubId: one(
      await schema.db
        .select({ id: schema.hub.id })
        .from(schema.hub)
        .where(eq(schema.hub.userId, userId)),
    ).id,
    refOrganizationId: base.orgId,
    refTaskId: task.id,
    date: '2026-06-30',
    timeboxStartsAt: new Date('2026-06-30T15:00:00.000Z'),
    timeboxEndsAt: new Date('2026-06-30T16:00:00.000Z'),
  });

  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId,
        externalAccountId: 'google-sub-1',
        accountEmail: 'ada@example.com',
        accountName: 'Ada',
        status: 'connected',
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  const selectedCalendar = one(
    await schema.db
      .insert(schema.calendarList)
      .values({
        userId,
        connectionId: connection.id,
        externalCalendarId: 'primary',
        title: 'Ada',
        color: '#16a34a',
        timezone: 'America/Los_Angeles',
        selected: true,
        visibleByDefault: true,
      })
      .returning({ id: schema.calendarList.id }),
  );
  const hiddenCalendar = one(
    await schema.db
      .insert(schema.calendarList)
      .values({
        userId,
        connectionId: connection.id,
        externalCalendarId: 'team',
        title: 'Team',
        selected: false,
        visibleByDefault: false,
      })
      .returning({ id: schema.calendarList.id }),
  );
  const selectedEvent = one(
    await schema.db
      .insert(schema.calendarEvent)
      .values({
        userId,
        connectionId: connection.id,
        calendarId: selectedCalendar.id,
        externalCalendarId: 'primary',
        externalEventId: 'event-1',
        status: 'confirmed',
        title: 'Design review',
        startsAt: new Date('2026-06-30T16:00:00.000Z'),
        endsAt: new Date('2026-06-30T17:00:00.000Z'),
        htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
      })
      .returning({ id: schema.calendarEvent.id }),
  );
  await schema.db.insert(schema.calendarEvent).values({
    userId,
    connectionId: connection.id,
    calendarId: hiddenCalendar.id,
    externalCalendarId: 'team',
    externalEventId: 'event-hidden',
    status: 'confirmed',
    title: 'Hidden sync',
    startsAt: new Date('2026-06-30T18:00:00.000Z'),
    endsAt: new Date('2026-06-30T19:00:00.000Z'),
  });

  return { schema, userId, base, connection, selectedCalendar, hiddenCalendar, selectedEvent };
}

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
  agendaRouter = (await import('../../src/routes/agenda')).default;
});

describe('first-party Google Calendar routes', () => {
  it('lists linked calendar accounts and calendars for the signed-in user', async () => {
    const fixture = await seedCalendarFixture();
    const app = appWithSession(calendarRouter, fakeSession(fixture.userId));

    const out = await body<CalendarSettingsOut>(await app.request('/'));

    expect(out.connections).toHaveLength(1);
    expect(out.connections[0]?.calendarsTotal).toBe(2);
    expect(out.connections[0]?.calendarsEnabled).toBe(1);
    expect(out.calendars.map((cal) => cal.title)).toEqual(['Ada', 'Team']);
  });

  it('updates calendar visibility and agenda filtering respects the selected set', async () => {
    const fixture = await seedCalendarFixture();
    const settings = appWithSession(calendarRouter, fakeSession(fixture.userId));
    const agenda = appWithSession(agendaRouter, fakeSession(fixture.userId));

    const before = await body<AgendaOut>(await agenda.request('/?date=2026-06-30'));
    expect(before.entries.some((entry) => entry.kind === 'google_calendar_event')).toBe(true);

    const patched = await body<CalendarSettingsOut>(
      await settings.request(`/calendars/${fixture.selectedCalendar.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected: false, visibleByDefault: false }),
      }),
    );
    expect(patched.calendars.find((cal) => cal.id === fixture.selectedCalendar.id)?.selected).toBe(
      false,
    );

    const after = await body<AgendaOut>(await agenda.request('/?date=2026-06-30'));
    expect(after.entries.filter((entry) => entry.kind === 'google_calendar_event')).toHaveLength(0);
  });

  it('combines Docket timeboxes with selected Google Calendar events', async () => {
    const fixture = await seedCalendarFixture();
    const app = appWithSession(agendaRouter, fakeSession(fixture.userId));

    const out = await body<AgendaOut>(
      await app.request(`/?date=2026-06-30&calendarIds=${fixture.selectedCalendar.id}`),
    );

    expect(out.entries.map((entry) => entry.kind)).toEqual([
      'task_timebox',
      'google_calendar_event',
    ]);
  });

  it('creates a task from a Google Calendar event and attaches event context', async () => {
    const fixture = await seedCalendarFixture();
    const app = appWithSession(calendarRouter, fakeSession(fixture.userId));

    const created = await body<TaskOut>(
      await app.request(`/events/${fixture.selectedEvent.id}/create-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: fixture.base.orgId,
          teamId: fixture.base.teamId,
          title: 'Follow up: Design review',
        }),
      }),
    );

    expect(created.title).toBe('Follow up: Design review');
    const attachments = await fixture.schema.db
      .select()
      .from(fixture.schema.attachment)
      .where(
        and(
          eq(fixture.schema.attachment.subjectId, created.id),
          eq(fixture.schema.attachment.kind, 'calendar_event'),
        ),
      );
    expect(attachments[0]?.externalId).toBe('event-1');
    expect(attachments[0]?.metadata).toMatchObject({
      calendarId: fixture.selectedCalendar.id,
      connectionId: fixture.connection.id,
    });
  });
});
