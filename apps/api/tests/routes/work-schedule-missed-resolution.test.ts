/** A calendar ask miss becomes work only through its reviewed, authorized durable run action. */
import type * as DbModule from '@docket/db';
import { beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { WorkScheduleRunOut, WorkScheduleRunPage } from '@docket/work/work-schedule-management';
import { getDb } from '../support/routes-harness';
import schedulesRouter from '../../src/routes/work-schedules';
import { scheduleRouteFixture, createSchedule } from './work-schedule-fixture';
import { materializeRecurrenceSeriesWindow } from '../../src/lib/recurrence/sweep';
import {
  executeScheduleOccurrence,
  retryScheduleOccurrence,
} from '../../src/lib/recurrence/schedule-runtime';
import { NotFoundError } from '../../src/error';
import { reviseWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function missedFixture() {
  const f = await scheduleRouteFixture(schema, schedulesRouter);
  f.command.effectiveFrom = '2026-10-01';
  f.command.trigger = {
    kind: 'calendar',
    schedule: {
      kind: 'daily',
      interval: 1,
      startDate: '2026-10-01',
      timezone: f.command.document.timezone,
      end: { kind: 'after_count', count: 2 },
    },
    missedPolicy: 'resolve',
    materialization: { horizonDays: 1, minimumOccurrences: 1 },
  };
  const schedule = await createSchedule(f);
  const sweep = {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    seriesId: schedule.id,
    asOf: '2026-10-03',
  };
  expect((await materializeRecurrenceSeriesWindow(schema.db, sweep)).needsResolution).toBe(2);
  await materializeRecurrenceSeriesWindow(schema.db, sweep);
  const history = WorkScheduleRunPage.parse(
    await (await f.app.request(`/${schedule.id}/runs`)).json(),
  );
  expect(history.items).toHaveLength(2);
  expect(
    history.items.every(
      (run) => run.status === 'needs_resolution' && run.canRetry && run.attempt === 0,
    ),
  ).toBe(true);
  const missed = history.items.find((run) => run.scheduledFor === '2026-10-01');
  if (!missed) throw new Error('Missing first calendar decision');
  return { f, schedule, missed };
}
it('leaves missed calendar dates awaiting review, then creates exactly that saved run once', async () => {
  const { f, schedule, missed } = await missedFixture();
  const future = await reviseWorkSchedule(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    seriesId: schedule.id,
    expectedRevisionId: schedule.revision.id,
    effectiveFrom: '2099-10-01',
    trigger: { kind: 'manual' },
    document: f.command.document,
  });
  expect(future.revision.id).not.toBe(schedule.revision.id);
  const response = await f.app.request(`/${schedule.id}/runs/${missed.id}/retry`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  const created = WorkScheduleRunOut.parse(await response.json());
  expect(created).toMatchObject({
    id: missed.id,
    scheduledFor: missed.scheduledFor,
    status: 'materialized',
    attempt: 1,
    canRetry: false,
  });
  expect(created.roots).toHaveLength(1);
  const [receipt] = await schema.db
    .select()
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.id, missed.id));
  expect(receipt?.seriesRevisionId).toBe(schedule.revision.id);
  expect(receipt?.acceptedClaim).not.toBeNull();
  const second = await f.app.request(`/${schedule.id}/runs/${missed.id}/retry`, { method: 'POST' });
  expect([404, 409]).toContain(second.status);
  const reread = WorkScheduleRunPage.parse(
    await (await f.app.request(`/${schedule.id}/runs`)).json(),
  ).items.find((run) => run.id === missed.id);
  expect(reread).toMatchObject({ roots: created.roots, attempt: 1 });
});

it('never turns an untouched ask decision into work through actorless engine execution', async () => {
  const { f, schedule, missed } = await missedFixture();
  await expect(
    retryScheduleOccurrence(schema.db, { organizationId: f.orgId, occurrenceId: missed.id }),
  ).rejects.toBeInstanceOf(NotFoundError);
  const untouched = await executeScheduleOccurrence(schema.db, {
    organizationId: f.orgId,
    seriesId: schedule.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: missed.scheduledFor,
  });
  expect(untouched).toMatchObject({
    occurrenceId: missed.id,
    status: 'needs_resolution',
    attempt: 0,
    roots: [],
  });
});
