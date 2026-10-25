import { expect } from 'vitest';
import type * as DbModule from '@docket/db';
import type { BlueprintOccurrenceRoot } from '@docket/db';
import { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import schedulesRouter from '../../src/routes/work-schedules';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import { one } from '../support/routes-harness';

type Base = Awaited<ReturnType<typeof scheduleRouteFixture>>;
/** Actual workspace, immutable v2 policy and durable generated work shared by both database drivers. */
export interface NativeFieldRuntimeFixture extends Base {
  readonly document: WorkScheduleForestV2;
  readonly schedule: Awaited<ReturnType<typeof createWorkSchedule>>;
  readonly run: Awaited<ReturnType<typeof executeScheduleOccurrence>>;
  readonly root: BlueprintOccurrenceRoot;
  readonly venue: NonNullable<BlueprintOccurrenceRoot['selectedWork']>[number];
}
/** Create a genuine eager Project/Task run with actual-completion start timing and no target-date default. */
export async function nativeFieldRuntimeFixture(
  schema: typeof DbModule,
): Promise<NativeFieldRuntimeFixture> {
  const base = await scheduleRouteFixture(schema, schedulesRouter);
  const document = WorkScheduleForestV2.parse({
    kind: 'forest',
    revision: 2,
    state: 'published',
    creationMode: 'when_ready',
    roots: [{ key: 'event', draft: base.command.document }],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'event', path: [], field: 'startDate' },
          source: { kind: 'after_completion', works: [{ rootKey: 'event', path: ['book_venue'] }] },
          offset: { days: 2, unit: 'calendar' },
        },
      ],
    },
    absentFields: [{ rootKey: 'event', path: [], field: 'targetDate' }],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [
      {
        target: { rootKey: 'event', path: [] },
        kind: 'project',
        pattern: 'Dinner {month} {unknown}',
      },
      {
        target: { rootKey: 'event', path: ['book_venue'] },
        kind: 'task',
        pattern: 'Venue {monthName}',
      },
    ],
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: [{ rootKey: 'event', path: ['book_venue'] }],
    },
  });
  const schedule = await createWorkSchedule(schema.db, {
    ...base.command,
    organizationId: base.orgId,
    actorId: base.humanActorId,
    document,
  });
  const run = await executeScheduleOccurrence(schema.db, {
    organizationId: base.orgId,
    seriesId: schedule.series.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: '2026-10-08',
  });
  expect(run.status).toBe('materialized');
  const root = one(run.roots),
    venue = root.selectedWork?.find((entry) => entry.path.join('/') === 'book_venue');
  if (!venue) throw new Error('Missing authored Task');
  return { ...base, document, schedule, run, root, venue };
}
