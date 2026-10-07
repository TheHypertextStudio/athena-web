import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import directiveFeed from '../../../src/routes/schedule-week-directive';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../../support/routes-harness';
const DAY = '2026-10-06';
let schema: typeof DbModule;
let db: typeof DbModule.db;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});
async function seedDay(label: string, _options: { plan: boolean }) {
  const userId = await seedUserWithHub(db, schema, label);
  const [hub] = await db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
  if (!hub) throw new Error('Missing seeded hub');
  return { directive: appWithSession(directiveFeed, fakeSession(userId)), hubId: hub.id, userId };
}
describe('accepted daily planning compatibility', () => {
  it('releases day-start without a weekly run and refuses legacy reorganization', async () => {
    const { directive, hubId, userId } = await seedDay('DailyAcceptedDirective', { plan: false });
    const snapshot = {
      date: DAY,
      finishAt: '2026-10-07T00:00:00.000Z',
      mainTaskId: null,
      tasks: [],
      sessions: [],
    };
    const acceptedAt = '2026-10-06T15:00:00.000Z';
    const version = { acceptedAt, snapshot };
    await db.insert(schema.dailyPlanDay).values({
      hubId,
      date: DAY,
      accepted: { original: version, current: version, history: [version] },
    });
    const response = await directive.request(`/day-start?date=${DAY}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ready: true,
      acknowledgedAt: acceptedAt,
      confirm: { confirmedAt: acceptedAt, outstanding: 0 },
      gate: { state: 'open' },
    });
    const feed = await directive.request(`/?date=${DAY}`);
    expect(
      ((await feed.json()) as { gates: { kind: string; state: string }[] }).gates,
    ).toContainEqual(expect.objectContaining({ kind: 'day_start', state: 'open' }));
    const acknowledged = await directive.request(`/day-start/acknowledge?date=${DAY}`, {
      method: 'POST',
    });
    expect(await acknowledged.json()).toMatchObject({ fired: false, acknowledgedAt: acceptedAt });
    const reorganize = await directive.request(`/reorganize?date=${DAY}`, { method: 'POST' });
    expect(reorganize.status).toBe(409);
    const dailyPlan = appWithSession(
      (await import('../../../src/routes/daily-plan')).default,
      fakeSession(userId),
    );
    expect(
      (
        await dailyPlan.request(`/day/${DAY}/draft`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ draft: snapshot, resumeStep: 'review_plan', expectedRevision: 0 }),
        })
      ).status,
    ).toBe(200);
    expect((await dailyPlan.request(`/day/${DAY}/confirm`, { method: 'POST' })).status).toBe(200);
    const [release] = await db
      .select()
      .from(schema.dayDirective)
      .where(eq(schema.dayDirective.hubId, hubId));
    expect(release?.agendaAcknowledgedAt?.toISOString()).toBe(acceptedAt);

    expect(
      await db.select().from(schema.dailyPlanDay).where(eq(schema.dailyPlanDay.hubId, hubId)),
    ).toMatchObject([{ accepted: { original: version, current: { snapshot } } }]);
  });
});
