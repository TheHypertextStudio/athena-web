import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { desc, eq, sql } from 'drizzle-orm';
import { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { authorizeNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-facts';
import { readNativeScheduleStatus } from '../../src/lib/recurrence/schedule-native-status';
import schedulesRouter from '../../src/routes/work-schedules';
import tasksRouter from '../../src/routes/tasks';
import projectsRouter from '../../src/routes/projects';
import { undoChangeSet } from '../../src/mcp/change-set';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { nativeFieldRuntimeFixture } from './work-schedule-field-runtime-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.useRealTimers();
});
const fixture = () => nativeFieldRuntimeFixture(schema);
async function state(f: Awaited<ReturnType<typeof fixture>>) {
  return schema.db.transaction(async (tx) =>
    readNativeScheduleStatus(
      tx,
      await authorizeNativeScheduleOccurrence(tx, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        occurrenceId: f.run.occurrenceId,
      }),
    ),
  );
}
function databaseConstraint(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  const cause: unknown = Reflect.get(error, 'cause');
  return cause && typeof cause === 'object'
    ? (Reflect.get(cause, 'constraint') ?? Reflect.get(cause, 'constraint_name'))
    : undefined;
}
it('creates waiting fields eagerly, then reflows actual Task completion through the ordinary API while the Project remains planned', async () => {
  const f = await fixture();
  const before = one(
    await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)),
  );
  expect(before).toMatchObject({
    name: 'Dinner 10 {unknown}',
    startDate: null,
    targetDate: null,
    status: 'planned',
  });
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))),
  ).toMatchObject({ title: 'Venue October', dueDate: null });
  expect(await state(f)).toEqual({ state: 'open', completedAt: null });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T06:30:00.000Z'));
  const response = await appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId).request(
    `/${f.venue.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    },
  );
  expect(response.status).toBe(200);
  const after = one(
    await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)),
  );
  expect(after.startDate?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  expect(after).toMatchObject({ targetDate: null, status: 'planned' });
  expect(await state(f)).toEqual({ state: 'completed', completedAt: '2026-10-10T06:30:00.000Z' });
});
it('keeps canceled or deleted authored Tasks incomplete without substituting Project status', async () => {
  const f = await fixture();
  await schema.db
    .update(schema.task)
    .set({ canceledAt: new Date(), completedAt: null })
    .where(eq(schema.task.id, f.venue.id));
  expect(await state(f)).toEqual({ state: 'open', completedAt: null });
  await schema.db.delete(schema.task).where(eq(schema.task.id, f.venue.id));
  expect(await state(f)).toEqual({ state: 'open', completedAt: null });
});

it('keeps the bound v2 revision readable through the authorized schedule detail contract', async () => {
  const f = await fixture();
  const response = await f.app.request(`/${f.schedule.series.id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    revision: { document: { kind: 'forest', revision: 2, titlePolicy: { kind: 'legacy_title' } } },
  });
});

it('rejects a forged saved timezone and a source field incompatible with exact accepted work', async () => {
  const f = await fixture();
  const occurrence = one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, f.run.occurrenceId)),
  );
  if (!occurrence.acceptedClaim) throw new Error('Missing native claim');
  await expect(
    schema.db.insert(schema.processOccurrence).values({
      organizationId: f.orgId,
      seriesId: f.schedule.series.id,
      seriesRevisionId: f.schedule.revision.id,
      scheduledFor: '2026-10-09',
      acceptedClaim: { ...occurrence.acceptedClaim, runDate: '2026-10-09', timezone: 'UTC' },
    }),
  ).rejects.toSatisfy((error: unknown) => databaseConstraint(error) === 'schedule_v2_context');
  const document = WorkScheduleForestV2.parse(f.schedule.revision.scheduleDraft);
  const forged = {
    ...document,
    timing: {
      ...document.timing,
      rules: [
        {
          target: { rootKey: 'event', path: [], field: 'startDate' },
          source: {
            kind: 'work_date',
            work: { rootKey: 'event', path: ['book_venue'] },
            field: 'targetDate',
          },
          offset: { days: 0, unit: 'calendar' },
        },
      ],
    },
  };
  await expect(
    schema.db.execute(
      sql`select docket_native_schedule_date_policy(${f.orgId},${JSON.stringify(forged)}::jsonb,${JSON.stringify(occurrence.blueprintRootRefs)}::jsonb)`,
    ),
  ).rejects.toSatisfy((error: unknown) => databaseConstraint(error) === 'schedule_date_actual');
});

it('allows a planned-date edit with read-only Project access, then atomically rejects completion that needs a Project write', async () => {
  const f = await fixture();
  const contributor = one(
    await schema.db
      .insert(schema.actor)
      .values({
        organizationId: f.orgId,
        kind: 'human',
        displayName: 'Field contributor',
        status: 'active',
      })
      .returning(),
  );
  await schema.db.insert(schema.grant).values([
    {
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: contributor.id,
      resourceKind: 'project',
      resourceId: f.root.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
    },
    {
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: contributor.id,
      resourceKind: 'task',
      resourceId: f.venue.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    },
  ]);
  const app = appWithActor(tasksRouter, f.orgId, ['contribute'], contributor.id);
  const hidden = await appWithActor(
    schedulesRouter,
    f.orgId,
    ['contribute'],
    contributor.id,
  ).request(`/${f.schedule.series.id}`);
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).not.toHaveProperty('revision');
  expect(
    (
      await app.request(`/${f.venue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: '2026-10-20' }),
      })
    ).status,
  ).toBe(200);
  const before = one(
    await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)),
  );
  expect(
    (
      await app.request(`/${f.venue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'done' }),
      })
    ).status,
  ).toBe(403);
  const after = one(
    await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)),
  );
  expect(after.completedAt).toEqual(before.completedAt);
  expect(after.state).toEqual(before.state);
  expect(
    one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
      .startDate,
  ).toBeNull();
});

it('undoes a start-date pin with its ownership companion and resumes actual completion derivation', async () => {
  const f = await fixture();
  const response = await appWithActor(projectsRouter, f.orgId, ['manage'], f.humanActorId).request(
    `/${f.root.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: '2026-10-13' }),
    },
  );
  expect(response.status).toBe(200);
  const receipt = one(
    await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId))
      .orderBy(desc(schema.changeSet.id))
      .limit(1),
  );
  const pinned = one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, f.run.occurrenceId)),
  );
  expect(pinned.scheduleDateOwnership?.find((entry) => entry.field === 'startDate')?.manual).toBe(
    true,
  );
  await undoChangeSet(f.orgId, receipt.id);
  expect(
    one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
      .startDate,
  ).toBeNull();
  const undone = one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, f.run.occurrenceId)),
  );
  expect(undone.scheduleDateOwnership?.find((entry) => entry.field === 'startDate')?.manual).toBe(
    false,
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T06:30:00.000Z'));
  expect(
    (
      await appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId).request(
        `/${f.venue.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'done' }),
        },
      )
    ).status,
  ).toBe(200);
  expect(
    one(
      await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)),
    ).startDate?.toISOString(),
  ).toBe('2026-10-11T00:00:00.000Z');
});

it('creates an independent Task start with absent due date and preserves authored blank root content', async () => {
  const base = await scheduleRouteFixture(schema, schedulesRouter);
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const template = await createWorkTemplate(caller, {
    targetType: 'task',
    scope: 'organization',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Task source',
      payload: {
        targetType: 'task',
        title: 'Inherited Task',
        description: 'Inherited **document**',
      },
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
      {
        key: 'task',
        draft: {
          kind: 'schedule',
          revision: 1,
          template: { targetType: 'task', workTypeId: template.id, selection: { kind: 'latest' } },
          titlePattern: 'Task',
          timezone: 'America/Los_Angeles',
          root: {
            kind: 'task',
            fields: { description: '' },
            dates: {},
            placement: {},
            teamId: base.teamId,
          },
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
          target: { rootKey: 'task', path: [], field: 'startDate' },
          source: { kind: 'run' },
          offset: { days: -2, unit: 'calendar' },
        },
      ],
    },
    absentFields: [{ rootKey: 'task', path: [], field: 'dueDate' }],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [
      { target: { rootKey: 'task', path: [] }, kind: 'task', pattern: 'Task {month} {unknown}' },
    ],
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: [{ rootKey: 'task', path: [] }],
    },
  });
  const schedule = await createWorkSchedule(schema.db, {
    ...base.command,
    ownerProgramId: null,
    trigger: { kind: 'manual' },
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
  const row = one(
    await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, one(run.roots).id)),
  );
  expect(row).toMatchObject({ title: 'Task 10 {unknown}', description: '', dueDate: null });
  expect(row.startDate?.toISOString()).toBe('2026-10-06T00:00:00.000Z');
});
