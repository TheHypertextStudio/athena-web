/**
 * `@docket/api` — `buildAgendaPayload` / `readCalendarSettings` (calendar-shared.ts), driven
 * directly (no HTTP router) against the seeded database.
 *
 * @remarks
 * `tests/routes/calendar-agenda.test.ts` and `calendar-shared-serializers.test.ts` already cover
 * this module's serializers and its happy-path route wiring. This file closes the branches those
 * leave untouched: a Hub-less caller, a daily-plan item with no timebox yet, the
 * `includeGoogleCalendar: false` short-circuit, the `connectionIds` post-filter (both an empty
 * and a matching result), and `readCalendarSettings`'s per-connection calendar counts.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as CalendarSharedModule from '../../src/routes/calendar-shared';
import {
  getDb,
  one,
  seedBaseOrg,
  seedGoogleAccount,
  seedUserWithHub,
} from '../support/routes-harness';

let calendarShared: typeof CalendarSharedModule;

beforeAll(async () => {
  calendarShared = await import('../../src/routes/calendar-shared');
});

describe('buildAgendaPayload', () => {
  it('returns no entries for a caller with no Hub row', async () => {
    const schema = await getDb();
    const userId = one(
      await schema.db
        .insert(schema.user)
        .values({ name: 'NoHub', email: `no-hub-${Math.random().toString(36).slice(2)}@x.test` })
        .returning({ id: schema.user.id }),
    ).id;

    const payload = await calendarShared.buildAgendaPayload(userId, { date: '2026-07-01' });
    expect(payload).toEqual({ date: '2026-07-01', entries: [] });
  });

  it('omits a daily-plan item that has no timebox scheduled yet', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NoTimebox');
    const base = await seedBaseOrg(schema.db, schema);
    const hubId = one(
      await schema.db
        .select({ id: schema.hub.id })
        .from(schema.hub)
        .where(eq(schema.hub.userId, userId)),
    ).id;
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Untimeboxed task',
          state: 'todo',
          priority: 'none',
        })
        .returning({ id: schema.task.id }),
    );
    await schema.db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: base.orgId,
      refTaskId: task.id,
      date: '2026-07-01',
    });

    const payload = await calendarShared.buildAgendaPayload(userId, {
      date: '2026-07-01',
      includeGoogleCalendar: false,
    });
    expect(payload.entries).toEqual([]);
  });

  it('includes a timeboxed daily-plan item as a task_timebox entry', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'Timeboxed');
    const base = await seedBaseOrg(schema.db, schema);
    const hubId = one(
      await schema.db
        .select({ id: schema.hub.id })
        .from(schema.hub)
        .where(eq(schema.hub.userId, userId)),
    ).id;
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Timeboxed task',
          state: 'todo',
          priority: 'high',
        })
        .returning({ id: schema.task.id }),
    );
    await schema.db.insert(schema.dailyPlanItem).values({
      hubId,
      refOrganizationId: base.orgId,
      refTaskId: task.id,
      date: '2026-07-01',
      timeboxStartsAt: new Date('2026-07-01T15:00:00.000Z'),
      timeboxEndsAt: new Date('2026-07-01T16:00:00.000Z'),
    });

    const payload = await calendarShared.buildAgendaPayload(userId, {
      date: '2026-07-01',
      includeGoogleCalendar: false,
    });
    expect(payload.entries).toEqual([
      expect.objectContaining({
        kind: 'task_timebox',
        taskId: task.id,
        title: 'Timeboxed task',
      }),
    ]);
  });

  async function seedGoogleEvent(label: string) {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, label);
    await seedGoogleAccount(schema.db, schema, userId, `${label}-sub`);
    const connection = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: `${label}-sub`,
          accountEmail: `${label}@example.com`,
          accountName: label,
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId,
          connectionId: connection.id,
          provider: 'google',
          sourceKind: 'provider_calendar',
          title: label,
          timezone: 'UTC',
          selected: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    await schema.db.insert(schema.calendarItem).values({
      userId,
      layerId: layer.id,
      connectionId: connection.id,
      kind: 'provider_event',
      provider: 'google',
      externalCalendarId: 'primary',
      externalEventId: `${label}-evt`,
      status: 'confirmed',
      title: `${label} event`,
      startsAt: new Date('2026-07-01T16:00:00.000Z'),
      endsAt: new Date('2026-07-01T17:00:00.000Z'),
      syncState: 'clean',
    });
    return { schema, userId, connectionId: connection.id };
  }

  it('skips Google Calendar enrichment entirely when includeGoogleCalendar is false', async () => {
    const { userId } = await seedGoogleEvent('SkipGCal');
    const payload = await calendarShared.buildAgendaPayload(userId, {
      date: '2026-07-01',
      includeGoogleCalendar: false,
    });
    expect(payload.entries).toEqual([]);
  });

  it('includes Google Calendar events by default (includeGoogleCalendar omitted)', async () => {
    const { userId } = await seedGoogleEvent('DefaultGCal');
    const payload = await calendarShared.buildAgendaPayload(userId, { date: '2026-07-01' });
    expect(payload.entries).toEqual([expect.objectContaining({ kind: 'google_calendar_event' })]);
  });

  it('returns no entries when connectionIds excludes every matching event', async () => {
    const { userId } = await seedGoogleEvent('FilteredOutGCal');
    const payload = await calendarShared.buildAgendaPayload(userId, {
      date: '2026-07-01',
      connectionIds: ['conn_does_not_exist'],
    });
    expect(payload.entries).toEqual([]);
  });

  it('includes the event when connectionIds names its connection', async () => {
    const { userId, connectionId } = await seedGoogleEvent('FilteredInGCal');
    const payload = await calendarShared.buildAgendaPayload(userId, {
      date: '2026-07-01',
      connectionIds: [connectionId],
    });
    expect(payload.entries).toEqual([expect.objectContaining({ kind: 'google_calendar_event' })]);
  });
});

describe('readCalendarSettings', () => {
  it('aggregates per-connection calendar counts and sorts connections by account email', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'SettingsUser');
    await seedGoogleAccount(schema.db, schema, userId, 'settings-sub-a');
    await seedGoogleAccount(schema.db, schema, userId, 'settings-sub-b');
    const connB = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: 'settings-sub-b',
          accountEmail: 'bea@example.com',
          accountName: 'Bea',
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    const connA = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({
          userId,
          externalAccountId: 'settings-sub-a',
          accountEmail: 'ada@example.com',
          accountName: 'Ada',
          status: 'connected',
        })
        .returning({ id: schema.calendarConnection.id }),
    );
    await schema.db.insert(schema.calendarList).values([
      {
        userId,
        connectionId: connA.id,
        externalCalendarId: 'primary',
        title: 'Ada Primary',
        selected: true,
      },
      {
        userId,
        connectionId: connA.id,
        externalCalendarId: 'team',
        title: 'Ada Team',
        selected: false,
      },
      {
        userId,
        connectionId: connB.id,
        externalCalendarId: 'primary',
        title: 'Bea Primary',
        selected: true,
      },
    ]);

    const settings = await calendarShared.readCalendarSettings(userId);
    expect(settings.connections.map((c) => c.accountEmail)).toEqual([
      'ada@example.com',
      'bea@example.com',
    ]);
    const adaConn = settings.connections.find((c) => c.id === connA.id);
    expect(adaConn).toMatchObject({ calendarsTotal: 2, calendarsEnabled: 1 });
    const beaConn = settings.connections.find((c) => c.id === connB.id);
    expect(beaConn).toMatchObject({ calendarsTotal: 1, calendarsEnabled: 1 });
  });

  it('reports zero calendars for a connection with none synced yet', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BareConnection');
    await seedGoogleAccount(schema.db, schema, userId, 'bare-sub');
    await schema.db.insert(schema.calendarConnection).values({
      userId,
      externalAccountId: 'bare-sub',
      accountEmail: 'bare@example.com',
      accountName: 'Bare',
      status: 'connected',
    });

    const settings = await calendarShared.readCalendarSettings(userId);
    expect(settings.connections).toEqual([
      expect.objectContaining({ calendarsTotal: 0, calendarsEnabled: 0 }),
    ]);
  });
});
