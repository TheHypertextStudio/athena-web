import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import type programsRouter from '../../src/routes/programs';
import type schedulesRouter from '../../src/routes/work-schedules';
import { appWithActor, getDb, seedProgram } from '../support/routes-harness';
import { createSchedule, scheduleRouteFixture } from './work-schedule-fixture';

let schema: typeof DbModule;
let programs: typeof programsRouter;
let schedules: typeof schedulesRouter;
beforeAll(async () => {
  schema = await getDb();
  programs = (await import('../../src/routes/programs')).default;
  schedules = (await import('../../src/routes/work-schedules')).default;
});

describe('Program removal with independently owned recurring work', () => {
  it('returns a conflict and preserves active and ended schedule history', async () => {
    const fixture = await scheduleRouteFixture(schema, schedules);
    const schedule = await createSchedule(fixture);
    const app = appWithActor(programs, fixture.orgId, ['manage'], fixture.humanActorId);
    for (const status of ['active', 'ended'] as const) {
      if (status === 'ended') {
        const ended = await fixture.app.request(`/${schedule.id}/lifecycle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'end' }),
        });
        expect(ended.status).toBe(200);
      }
      const response = await app.request(`/${fixture.program.id}`, { method: 'DELETE' });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'conflict' });
      expect(
        await schema.db
          .select()
          .from(schema.program)
          .where(eq(schema.program.id, fixture.program.id)),
      ).toHaveLength(1);
      expect(
        await schema.db
          .select()
          .from(schema.recurrenceSeriesRevision)
          .where(eq(schema.recurrenceSeriesRevision.seriesId, schedule.id)),
      ).toHaveLength(1);
    }
  });

  it('still removes a Program without owned schedules', async () => {
    const fixture = await scheduleRouteFixture(schema, schedules);
    const empty = await seedProgram(schema.db, schema, fixture.statusId, {
      organizationId: fixture.orgId,
      name: 'Temporary operations',
      createdBy: fixture.humanActorId,
    });
    const app = appWithActor(programs, fixture.orgId, ['manage'], fixture.humanActorId);
    expect((await app.request(`/${empty.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/${empty.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('allows complete workspace purging to remove owned schedules and accepted runs', async () => {
    const fixture = await scheduleRouteFixture(schema, schedules);
    const schedule = await createSchedule(fixture);
    const run = await fixture.app.request(`/${schedule.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledFor: '2026-10-08' }),
    });
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ status: 'materialized' });
    await expect(
      schema.db.delete(schema.organization).where(eq(schema.organization.id, fixture.orgId)),
    ).resolves.toBeDefined();
    expect(
      await schema.db
        .select()
        .from(schema.recurrenceSeries)
        .where(eq(schema.recurrenceSeries.organizationId, fixture.orgId)),
    ).toEqual([]);
  });
});
