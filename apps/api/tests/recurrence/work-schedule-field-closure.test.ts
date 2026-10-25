import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import tasksRouter from '../../src/routes/tasks';
import schedulesRouter from '../../src/routes/work-schedules';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.useRealTimers());

it('uses exact cross-root Task completion while ignoring template-only open descendants and a changed planned due date', async () => {
  const f = await scheduleRouteFixture(schema, schedulesRouter);
  const caller = {
    orgId: f.orgId,
    actorId: f.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const template = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'organization',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Email',
      payload: { targetType: 'task', title: 'Email' },
      blueprint: { steps: [], dependencies: [] },
    }),
  });
  await publishWorkTemplate(caller, template.id, template.draftRevision);
  const document = WorkScheduleForestV2.parse({
    kind: 'forest',
    revision: 2,
    state: 'published',
    creationMode: 'all_at_once',
    roots: [
      { key: 'event', draft: f.command.document },
      {
        key: 'email',
        draft: {
          kind: 'schedule',
          revision: 1,
          template: { targetType: 'task', workTypeId: template.id, selection: { kind: 'latest' } },
          titlePattern: 'Email',
          timezone: 'America/Los_Angeles',
          root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: f.teamId },
          stepOverrides: [],
          optionalChoices: [],
        },
      },
    ],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'event', path: [], field: 'startDate' },
          source: { kind: 'after_completion', works: [{ rootKey: 'email', path: [] }] },
          offset: { days: 2, unit: 'calendar' },
        },
        {
          target: { rootKey: 'email', path: [], field: 'dueDate' },
          source: { kind: 'run' },
          offset: { days: 0, unit: 'calendar' },
        },
      ],
    },
    absentFields: [
      { rootKey: 'event', path: [], field: 'targetDate' },
      { rootKey: 'email', path: [], field: 'startDate' },
    ],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [
      { target: { rootKey: 'event', path: [] }, kind: 'project', pattern: 'Event {month}' },
      { target: { rootKey: 'email', path: [] }, kind: 'task', pattern: 'Email {date}' },
    ],
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: [{ rootKey: 'email', path: [] }],
    },
  });
  const schedule = await createWorkSchedule(schema.db, {
    ...f.command,
    ownerProgramId: null,
    organizationId: f.orgId,
    actorId: f.humanActorId,
    document,
  });
  const run = await executeScheduleOccurrence(schema.db, {
    organizationId: f.orgId,
    seriesId: schedule.series.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: '2026-10-08',
  });
  expect(run.status).toBe('materialized');
  const event = run.roots.find((root) => root.key === 'event'),
    email = run.roots.find((root) => root.key === 'email');
  const venue = event?.selectedWork?.find((work) => work.path.join('/') === 'book_venue');
  if (!event || !email || !venue) throw new Error('Missing complete eager forest');
  expect(
    one(await schema.db.select().from(schema.project).where(eq(schema.project.id, event.id))),
  ).toMatchObject({ startDate: null, targetDate: null, status: 'planned' });
  const app = appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId);
  expect(
    (
      await app.request(`/${email.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: '2030-01-01' }),
      })
    ).status,
  ).toBe(200);
  expect(
    one(await schema.db.select().from(schema.project).where(eq(schema.project.id, event.id)))
      .startDate,
  ).toBeNull();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T06:30:00.000Z'));
  expect(
    (
      await app.request(`/${email.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'done' }),
      })
    ).status,
  ).toBe(200);
  const after = one(
    await schema.db.select().from(schema.project).where(eq(schema.project.id, event.id)),
  );
  expect(after.startDate?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  expect(after).toMatchObject({ targetDate: null, status: 'planned' });
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, venue.id))).completedAt,
  ).toBeNull();
  const occurrence = one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, run.occurrenceId)),
  );
  expect(occurrence.status).toBe('completed');
  expect(occurrence.completedAt?.toISOString()).toBe('2026-10-10T06:30:00.000Z');
});
