import { expect } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { moveNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-movement';
import schedulesRouter from '../../src/routes/work-schedules';
import tasksRouter from '../../src/routes/tasks';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import { appWithActor, one } from '../support/routes-harness';
/** Create an actual native dinner run with optional forest timing and completion cadence. */
export async function nativeRuntimeFixture(
  schema: typeof DbModule,
  forest = false,
  afterCompletion = false,
) {
  const base = await scheduleRouteFixture(schema, schedulesRouter);
  const native = base.command.document;
  const document = forest
    ? WorkScheduleForest.parse({
        kind: 'forest',
        revision: 1,
        state: 'published',
        roots: [
          { key: 'one', draft: native },
          { key: 'two', draft: native },
        ],
        dependencies: [],
        timing: [
          {
            target: { rootKey: 'one', path: ['book_venue'] },
            prerequisite: { rootKey: 'two', path: [] },
            offsetDays: -2,
          },
        ],
      })
    : native;
  const schedule = await createWorkSchedule(schema.db, {
    ...base.command,
    organizationId: base.orgId,
    actorId: base.humanActorId,
    document,
    trigger: afterCompletion
      ? { kind: 'after_completion', interval: 1, unit: 'day' }
      : base.command.trigger,
  });
  const input = {
    organizationId: base.orgId,
    seriesId: schedule.series.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: '2026-10-08',
    externalOccurrenceKey: 'provider-event-42',
  };
  const run = await executeScheduleOccurrence(schema.db, input);
  expect(run.status).toBe('materialized');
  const root = one(run.roots);
  const venue = root.selectedWork?.find((entry) => entry.path.join('/') === 'book_venue');
  if (!venue) throw new Error('Missing generated preparation Task');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  return { ...base, caller, schedule, input, run, root, venue };
}
/** Read one persisted native run for assertions. */
export async function nativeOccurrence(schema: typeof DbModule, id: string) {
  return one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, id)),
  );
}
/** Move the same actual provider run through the native date service. */
export async function nativeMove(
  schema: typeof DbModule,
  f: Awaited<ReturnType<typeof nativeRuntimeFixture>>,
  scheduledFor: string,
) {
  return schema.db.transaction((tx) =>
    moveNativeScheduleOccurrence(tx, {
      organizationId: f.orgId,
      occurrenceId: f.run.occurrenceId,
      externalOccurrenceKey: f.input.externalOccurrenceKey,
      scheduledFor,
    }),
  );
}
/** Set an actual preparation date through its ordinary authenticated API. */
export async function nativePin(
  f: Awaited<ReturnType<typeof nativeRuntimeFixture>>,
  dueDate: string | null,
) {
  const response = await appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId).request(
    `/${f.venue.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dueDate }),
    },
  );
  expect(response.status).toBe(200);
}
