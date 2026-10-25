import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { desc, eq } from 'drizzle-orm';
import { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { createWorkSchedule } from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { undoChangeSet } from '../../src/mcp/change-set';
import { readNativeScheduleStatus } from '../../src/lib/recurrence/schedule-native-status';
import { authorizeNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-facts';
import {
  loadNativeScheduleSnapshot,
  mergeNativeScheduleSnapshotNodes,
} from '../../src/lib/recurrence/schedule-native-snapshot';
import tasksRouter from '../../src/routes/tasks';
import schedulesRouter from '../../src/routes/work-schedules';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function fixture() {
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
      name: 'Selected Task outline',
      payload: { targetType: 'task', title: 'Selected Task' },
      blueprint: { steps: [], dependencies: [] },
    }),
  });
  const publication = await publishWorkTemplate(caller, template.id, template.draftRevision);
  const version = publication.latestPublishedVersionId;
  if (!version) throw new Error('Missing selected Task publication');
  const draft = {
    kind: 'schedule',
    revision: 1,
    template: {
      targetType: 'task',
      workTypeId: template.id,
      selection: { kind: 'pinned', workTypeVersionId: version },
    },
    titlePattern: 'Selected Task',
    timezone: 'America/Los_Angeles',
    root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: base.teamId },
    stepOverrides: [],
    optionalChoices: [],
  };
  const document = WorkScheduleForestV2.parse({
    kind: 'forest',
    revision: 2,
    state: 'published',
    creationMode: 'all_at_once',
    roots: [
      { key: 'child', draft },
      { key: 'parent', draft },
      { key: 'event', draft: base.command.document },
    ],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'child', path: [], field: 'dueDate' },
          source: { kind: 'run' },
          offset: { days: 0, unit: 'calendar' },
        },
      ],
    },
    absentFields: [],
    titlePolicy: { kind: 'native_title', revision: 1 },
    titles: [],
    completionPolicy: { kind: 'terminal_actual_tree', revision: 1 },
    placements: [
      { rootKey: 'parent', project: { rootKey: 'event', path: [] } },
      {
        rootKey: 'child',
        project: { rootKey: 'event', path: [] },
        parentTask: { rootKey: 'parent', path: [] },
      },
    ],
  });
  return { ...base, document };
}
async function counts(organizationId: string) {
  return {
    tasks: (
      await schema.db
        .select()
        .from(schema.task)
        .where(eq(schema.task.organizationId, organizationId))
    ).length,
    projects: (
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, organizationId))
    ).length,
    series: (
      await schema.db
        .select()
        .from(schema.recurrenceSeries)
        .where(eq(schema.recurrenceSeries.organizationId, organizationId))
    ).length,
  };
}
it('creates selected Task roots under exact prospective Project and Task parents in one eager forest', async () => {
  const f = await fixture();
  const schedule = await createWorkSchedule(schema.db, {
    ...f.command,
    organizationId: f.orgId,
    actorId: f.humanActorId,
    document: f.document,
  });
  const run = await executeScheduleOccurrence(schema.db, {
    organizationId: f.orgId,
    seriesId: schedule.series.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: '2026-10-08',
  });
  expect(run.status).toBe('materialized');
  expect(run.roots.map((root) => root.key)).toEqual(['event', 'parent', 'child']);
  const snapshot = await schema.db.transaction(async (tx) =>
    loadNativeScheduleSnapshot(
      tx,
      await authorizeNativeScheduleOccurrence(tx, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        occurrenceId: run.occurrenceId,
      }),
      'view',
    ),
  );
  expect(new Set(snapshot.nodes.map((node) => node.id)).size).toBe(snapshot.nodes.length);
  const sample = snapshot.nodes[0];
  if (!sample) throw new Error('Missing actual snapshot');
  const fiveHundred = Array.from({ length: 500 }, (_, index) => ({
    ...sample,
    id: `physical_${index}`,
  }));
  expect(mergeNativeScheduleSnapshotNodes([fiveHundred, fiveHundred])).toHaveLength(500);
  expect(() =>
    mergeNativeScheduleSnapshotNodes([fiveHundred, [{ ...sample, id: 'physical_501' }]]),
  ).toThrow('Reflow at most 500 distinct actual work items.');

  const event = run.roots.find((root) => root.key === 'event'),
    parent = run.roots.find((root) => root.key === 'parent'),
    child = run.roots.find((root) => root.key === 'child');
  if (!event || !parent || !child) throw new Error('Missing eager private roots');
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, parent.id))),
  ).toMatchObject({ projectId: event.id, parentTaskId: null });
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id))),
  ).toMatchObject({ projectId: event.id, parentTaskId: parent.id });
  const app = appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId);
  const reparent = await app.request(`/${child.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentTaskId: null }),
  });
  expect(reparent.status).toBe(200);
  const pin = await app.request(`/${child.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dueDate: '2030-01-01' }),
  });
  expect(pin.status).toBe(200);
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
      .where(eq(schema.processOccurrence.id, run.occurrenceId)),
  );
  expect(pinned.scheduleDateOwnership).toEqual([
    expect.objectContaining({
      rootKey: 'child',
      path: [],
      id: child.id,
      field: 'dueDate',
      manual: true,
    }),
  ]);
  await expect(
    schema.db
      .update(schema.processOccurrence)
      .set({ blueprintRootRefs: [] })
      .where(eq(schema.processOccurrence.id, run.occurrenceId)),
  ).rejects.toThrow();
  await expect(
    schema.db
      .update(schema.processOccurrence)
      .set({ acceptedClaim: null })
      .where(eq(schema.processOccurrence.id, run.occurrenceId)),
  ).rejects.toThrow();
  await undoChangeSet(f.orgId, receipt.id);
  const undone = one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, run.occurrenceId)),
  );
  expect(undone.scheduleDateOwnership).toEqual([
    expect.objectContaining({
      rootKey: 'child',
      path: [],
      id: child.id,
      field: 'dueDate',
      manual: false,
    }),
  ]);
  expect(undone.blueprintRootRefs).toEqual(pinned.blueprintRootRefs);
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id))),
  ).toMatchObject({ title: 'Selected Task', dueDate: new Date('2026-10-08T00:00:00.000Z') });
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id))),
  ).toMatchObject({ projectId: event.id, parentTaskId: null });
});
it.each(['wrong_kind', 'missing_path'])(
  'rejects %s qualified parents before any work or schedule persists',
  async (kind) => {
    const f = await fixture(),
      before = await counts(f.orgId);
    const document = WorkScheduleForestV2.parse({
      ...f.document,
      placements: [
        {
          rootKey: 'parent',
          project: { rootKey: 'event', path: kind === 'wrong_kind' ? ['book_venue'] : ['missing'] },
        },
      ],
    });
    await expect(
      createWorkSchedule(schema.db, {
        ...f.command,
        organizationId: f.orgId,
        actorId: f.humanActorId,
        document,
      }),
    ).rejects.toThrow('The private selected parent path changed.');
    expect(await counts(f.orgId)).toEqual(before);
  },
);

it('resolves a selected Task parent through an exact nested selected publication slot', async () => {
  const f = await fixture();
  const document = WorkScheduleForestV2.parse({
    ...f.document,
    placements: [
      {
        rootKey: 'parent',
        project: { rootKey: 'event', path: [] },
        parentTask: { rootKey: 'event', path: ['book_venue'] },
      },
      {
        rootKey: 'child',
        project: { rootKey: 'event', path: [] },
        parentTask: { rootKey: 'parent', path: [] },
      },
    ],
  });
  const schedule = await createWorkSchedule(schema.db, {
    ...f.command,
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
    parent = run.roots.find((root) => root.key === 'parent');
  const venue = event?.selectedWork?.find((work) => work.path.join('/') === 'book_venue');
  if (!parent || !event || !venue) throw new Error('Missing nested selected parent');
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, parent.id))),
  ).toMatchObject({ projectId: event.id, parentTaskId: venue.id });
});

it('keeps authored title and completion aliases exact when selected roots overlap physically', async () => {
  const f = await fixture();
  const document = WorkScheduleForestV2.parse({
    ...f.document,
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [
      { target: { rootKey: 'event', path: [] }, kind: 'project', pattern: 'Dinner {month}' },
      { target: { rootKey: 'parent', path: [] }, kind: 'task', pattern: 'Parent {month}' },
      { target: { rootKey: 'child', path: [] }, kind: 'task', pattern: 'Child {month}' },
    ],
    completionPolicy: {
      kind: 'legacy_authored_tasks',
      revision: 1,
      tasks: [
        { rootKey: 'parent', path: [] },
        { rootKey: 'child', path: [] },
      ],
    },
  });
  const schedule = await createWorkSchedule(schema.db, {
    ...f.command,
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
  const parent = run.roots.find((root) => root.key === 'parent'),
    child = run.roots.find((root) => root.key === 'child'),
    event = run.roots.find((root) => root.key === 'event');
  if (!parent || !child || !event) throw new Error('Missing authored selected roots');
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, parent.id))).title,
  ).toBe('Parent 10');
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id))).title,
  ).toBe('Child 10');
  const app = appWithActor(tasksRouter, f.orgId, ['manage'], f.humanActorId);
  for (const id of [child.id, parent.id])
    expect(
      (
        await app.request(`/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'done' }),
        })
      ).status,
    ).toBe(200);
  const status = await schema.db.transaction(async (tx) =>
    readNativeScheduleStatus(
      tx,
      await authorizeNativeScheduleOccurrence(tx, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        occurrenceId: run.occurrenceId,
      }),
    ),
  );
  expect(status.state).toBe('completed');
  expect(
    one(await schema.db.select().from(schema.project).where(eq(schema.project.id, event.id)))
      .status,
  ).toBe('planned');
  const venue = event.selectedWork?.find((work) => work.path.join('/') === 'book_venue');
  if (!venue) throw new Error('Missing public selected child');
  expect(
    one(await schema.db.select().from(schema.task).where(eq(schema.task.id, venue.id))).completedAt,
  ).toBeNull();
});
