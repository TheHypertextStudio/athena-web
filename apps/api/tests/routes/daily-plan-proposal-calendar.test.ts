import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import { acceptDailyDraft } from '@docket/planning/daily-plan-flow';
import { loadAcceptedToday } from '../../src/routes/hub-today-accepted';
import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedGoogleAccount,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let router: typeof dailyPlanRouter;
const date = '2027-01-05';
const at = (hour: number): string => `2027-01-05T${String(hour).padStart(2, '0')}:00:00.000Z`;

beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/daily-plan')).default;
});

async function account(label: string) {
  const userId = await seedUserWithHub(schema.db, schema, label);
  const base = await seedBaseOrg(schema.db, schema);
  await schema.db
    .update(schema.actor)
    .set({ userId })
    .where(eq(schema.actor.id, base.humanActorId));
  const work = one(
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        title: 'Write the update',
        assigneeId: base.humanActorId,
        state: 'todo',
        statusId: base.statusId('task', 'todo'),
        visibility: 'public',
        estimateMinutes: 45,
      })
      .returning(),
  );
  await seedGoogleAccount(schema.db, schema, userId, `${label}-sub`);
  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId,
        externalAccountId: `${label}-sub`,
        accountEmail: `${label}@example.com`,
        status: 'connected',
      })
      .returning(),
  );
  const layer = one(
    await schema.db
      .insert(schema.calendarLayer)
      .values({
        userId,
        connectionId: connection.id,
        provider: 'google',
        sourceKind: 'provider_calendar',
        title: 'Personal calendar',
        timezone: 'UTC',
        selected: true,
      })
      .returning(),
  );
  return { userId, work, connectionId: connection.id, layerId: layer.id };
}

async function providerEvent(
  context: Awaited<ReturnType<typeof account>>,
  title: string,
  providerRaw: Record<string, unknown>,
  timed = false,
) {
  await schema.db.insert(schema.calendarItem).values({
    userId: context.userId,
    layerId: context.layerId,
    connectionId: context.connectionId,
    kind: 'provider_event',
    provider: 'google',
    externalCalendarId: 'primary',
    externalEventId: title,
    status: 'confirmed',
    title,
    providerRaw,
    startsAt: timed ? new Date(at(9)) : null,
    endsAt: timed ? new Date(at(17)) : null,
    allDayStartDate: timed ? null : date,
    allDayEndDate: timed ? null : '2027-01-06',
  });
}

async function propose(userId: string) {
  const app = appWithSession(router, fakeSession(userId));
  const response = await app.request(`/day/${date}/proposal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    availableMinutes: number;
    draft: { tasks: { taskId: string }[]; sessions: { startsAt: string }[] };
    unplaced: unknown[];
  }>;
}

describe('daily proposal with provider availability', () => {
  it('keeps transparent all-day and timed context without consuming work capacity', async () => {
    const context = await account('FreeCalendarProposal');
    await providerEvent(context, 'Week Without Driving', { transparency: 'transparent' });
    await providerEvent(context, 'Home', { eventType: 'workingLocation' });
    await providerEvent(context, 'Cycle context', { transparency: 'transparent' }, true);
    const result = await propose(context.userId);
    expect(result.availableMinutes).toBe(480);
    expect(result.draft.tasks).toEqual([expect.objectContaining({ taskId: context.work.id })]);
    expect(result.draft.sessions[0]?.startsAt).toBe(at(9));
    expect(result.unplaced).toEqual([]);
  });

  it('preserves an explicitly busy all-day event and does not fill the draft with backlog work', async () => {
    const context = await account('BusyCalendarProposal');
    await providerEvent(context, 'Out of office', {
      eventType: 'outOfOffice',
      transparency: 'opaque',
    });
    const result = await propose(context.userId);
    expect(result.availableMinutes).toBe(0);
    expect(result.draft.tasks).toEqual([]);
    expect(result.draft.sessions).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it('does not put a free calendar event ahead of accepted work in Today', async () => {
    const context = await account('FreeTodayCalendar');
    await providerEvent(context, 'Working context', { transparency: 'transparent' }, true);
    await providerEvent(context, 'Real appointment', { transparency: 'opaque' }, true);
    await providerEvent(context, 'Out of office', { transparency: 'opaque' });
    const hub = one(
      await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, context.userId)),
    );
    await schema.db.insert(schema.dailyPlanDay).values({
      hubId: hub.id,
      date,
      accepted: acceptDailyDraft(
        { date, finishAt: at(17), mainTaskId: null, tasks: [], sessions: [] },
        at(8),
      ),
    });
    const accepted = await loadAcceptedToday({
      hubId: hub.id,
      userId: context.userId,
      date,
      dayStart: new Date(at(0)),
      dayEnd: new Date('2027-01-06T00:00:00.000Z'),
    });
    expect(accepted.events.map((event) => event.title)).toEqual([
      'Out of office',
      'Real appointment',
    ]);
    expect(accepted.events.find((event) => event.title === 'Out of office')).toEqual({
      title: 'Out of office',
      startsAt: at(0),
      endsAt: '2027-01-06T00:00:00.000Z',
    });
  });
});
