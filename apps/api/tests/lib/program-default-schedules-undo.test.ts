import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { TaskCreate } from '@docket/work/task-model';
import { createWork } from '../../src/lib/work-creation/service';
import { editWorkTemplateDraft, publishWorkTemplate } from '../../src/lib/templates/service';
import { runWorkSchedule } from '../../src/lib/recurrence/schedule-run-commands';
import { undoChangeSet } from '../../src/mcp/change-set';
import { getDb } from '../support/routes-harness';
import { defaultScheduleFixture } from './program-default-schedules-fixture';
import { appProvenance, originFor } from '../../src/lib/provenance/context';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function setup(withCheckpoint = false) {
  const fixture = await defaultScheduleFixture(schema);
  if (withCheckpoint) await includeCheckpoint(fixture);
  const created = await createWork(fixture.command);
  const [series] = await schema.db
    .select()
    .from(schema.recurrenceSeries)
    .where(eq(schema.recurrenceSeries.ownerProgramId, created.root.id));
  if (!series) throw new Error('Missing Program routine');
  const [revision] = await schema.db
    .select()
    .from(schema.recurrenceSeriesRevision)
    .where(eq(schema.recurrenceSeriesRevision.seriesId, series.id));
  if (!revision || !created.changeSetId) throw new Error('Missing Program receipt');
  return { ...fixture, created, series, revision, changeSetId: created.changeSetId };
}

async function includeCheckpoint(f: Awaited<ReturnType<typeof defaultScheduleFixture>>) {
  const steps = [
    { key: 'event', kind: 'project', parentStepKey: null, sort: 1, fields: { name: 'Host event' } },
    {
      key: 'ready',
      kind: 'milestone',
      parentStepKey: 'event',
      sort: 0,
      fields: { name: 'Ready to host' },
    },
    {
      key: 'check',
      kind: 'task',
      parentStepKey: 'ready',
      sort: 0,
      fields: { title: 'Check the venue' },
    },
  ].map((step) =>
    BlueprintStep.parse({
      ...step,
      template: null,
      optional: { enabled: false, selectedByDefault: true },
      teamRule: 'creation_team',
      actorRule: 'creator',
      ...(step.kind === 'task' ? { cycleRule: 'none' } : {}),
      dates: {},
    }),
  );
  const definition = WorkTemplateDefinition.parse({
    ...f.published.draftDefinition,
    blueprint: {
      ...f.published.draftDefinition.blueprint,
      steps: [...f.published.draftDefinition.blueprint.steps, ...steps],
    },
  });
  const edited = await editWorkTemplateDraft(f.caller, f.published.id, {
    expectedRevision: f.published.draftRevision,
    definition,
  });
  await publishWorkTemplate(f.caller, edited.id, edited.draftRevision);
}

describe('undoing Program creation with independently installed routines', () => {
  it('ends the created routine and archives the Program and its original included work together', async () => {
    const f = await setup();
    await undoChangeSet(f.orgId, f.changeSetId);
    const [series] = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const [program] = await schema.db
      .select()
      .from(schema.program)
      .where(eq(schema.program.id, f.created.root.id));
    expect(series).toMatchObject({ status: 'ended', id: f.series.id });
    expect(program?.archivedAt).toBeInstanceOf(Date);
    const children = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.programId, f.created.root.id));
    expect(children).toHaveLength(1);
    expect(children[0]?.archivedAt).toBeInstanceOf(Date);
  });

  it('keeps already generated work and the exact accepted run history when ending the created copy', async () => {
    const f = await setup();
    const run = await runWorkSchedule(
      schema.db,
      {
        organizationId: f.orgId,
        actorId: f.caller.actorId,
        seriesId: f.series.id,
      },
      { scheduledFor: f.revision.effectiveFrom },
    );
    const [before] = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, run.id));
    expect(before?.blueprintAppliedAt).toBeInstanceOf(Date);
    await undoChangeSet(f.orgId, f.changeSetId);
    const [after] = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, run.id));
    expect(after).toEqual(before);
    const projects = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.programId, f.created.root.id));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.archivedAt).toBeNull();
    const [series] = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    expect(series?.status).toBe('ended');
  });

  it('refuses the complete undo when a routine has been independently changed', async () => {
    const f = await setup();
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ name: 'Owner revised this routine' })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    await expect(undoChangeSet(f.orgId, f.changeSetId)).rejects.toMatchObject({ status: 409 });
    const [program] = await schema.db
      .select()
      .from(schema.program)
      .where(eq(schema.program.id, f.created.root.id));
    const [series] = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    const [receipt] = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.id, f.changeSetId));
    expect(program?.archivedAt).toBeNull();
    expect(series).toMatchObject({ name: 'Owner revised this routine', status: 'active' });
    expect(receipt?.undoneAt).toBeNull();
  });

  it('reverses nested Project and checkpoint creation together with the installed routine', async () => {
    const f = await setup(true);
    expect(f.created.created.some((work) => work.kind === 'milestone')).toBe(true);
    await undoChangeSet(f.orgId, f.changeSetId);
    expect(
      await schema.db
        .select()
        .from(schema.milestone)
        .where(eq(schema.milestone.organizationId, f.orgId)),
    ).toHaveLength(0);
    const projects = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.programId, f.created.root.id));
    expect(projects).toHaveLength(1);
    expect(projects[0]?.archivedAt).toBeInstanceOf(Date);
  });

  it('keeps the complete creation when later active work uses its checkpoint', async () => {
    const f = await setup(true);
    const [checkpoint] = await schema.db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.organizationId, f.orgId));
    if (!checkpoint) throw new Error('Missing checkpoint');
    await createWork({
      caller: f.caller,
      kind: 'task',
      body: TaskCreate.parse({
        title: 'Later independent work',
        teamId: f.teamId,
        projectId: checkpoint.projectId,
        milestoneId: checkpoint.id,
      }),
      invocation: { origin: originFor('task_create', {}, appProvenance()) },
    });
    await expect(undoChangeSet(f.orgId, f.changeSetId)).rejects.toMatchObject({ status: 409 });
    const [program] = await schema.db
      .select()
      .from(schema.program)
      .where(eq(schema.program.id, f.created.root.id));
    const [series] = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    expect(program?.archivedAt).toBeNull();
    expect(series?.status).toBe('active');
  });
});
