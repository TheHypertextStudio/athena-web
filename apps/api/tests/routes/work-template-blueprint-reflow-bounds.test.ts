import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import projects from '../../src/routes/projects';
import tasks from '../../src/routes/tasks';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { TeamId } from '@docket/identity-access/ids';
import { WorkTypeId } from '@docket/work/ids';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { createWork } from '../../src/lib/work-creation/service';
import { appProvenance, originFor } from '../../src/lib/provenance/context';
import { prepareBlueprintReflow } from '../../src/lib/work-template-blueprints/reflow';
import { flushDeferredWork } from '../../src/lib/after-response';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(flushDeferredWork);
const headers = { 'content-type': 'application/json' };
async function manualChildren(f: Awaited<ReturnType<typeof reflowFixture>>, count: number) {
  await schema.db.insert(schema.task).values(
    Array.from({ length: count }, (_, index) => ({
      organizationId: f.orgId,
      teamId: f.teamId,
      projectId: f.root.id,
      title: `Unrelated manual ${index}`,
      state: 'todo',
      statusId: f.statusId('task', 'todo'),
    })),
  );
}
function initiativeSteps() {
  const common = {
    sort: 0,
    template: null,
    optional: { enabled: false, selectedByDefault: true },
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    dates: {},
  };
  return (['program', 'project'] as const).flatMap((kind, sort) => [
    BlueprintStep.parse({
      ...common,
      key: kind,
      kind,
      sort,
      parentStepKey: null,
      fields: { name: `Generated ${kind}` },
    }),
    BlueprintStep.parse({
      ...common,
      key: `${kind}_task`,
      kind: 'task',
      sort: sort + 2,
      parentStepKey: kind,
      fields: { title: `${kind} child` },
      cycleRule: 'none',
    }),
    BlueprintStep.parse({
      ...common,
      key: `${kind}_dependent`,
      kind: 'task',
      sort: sort + 4,
      parentStepKey: kind,
      fields: { title: `${kind} dependent` },
      cycleRule: 'none',
      dates: {
        dueDate: {
          kind: 'after_completion',
          stepKeys: [`${kind}_task`],
          offset: { days: 1, unit: 'calendar' },
        },
      },
    }),
  ]);
}
async function initiativeAncestryFixture() {
  const f = await reflowFixture(schema);
  const draft = await createWorkTemplate(f.caller, {
    targetType: 'initiative',
    scope: 'personal',
    offeredTeamIds: [],
    definition: WorkTemplateDefinition.parse({
      name: 'Operating initiative',
      payload: { targetType: 'initiative' },
      blueprint: { steps: initiativeSteps(), dependencies: [] },
    }),
  });
  const published = await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
  const created = await createWork({
    caller: f.caller,
    kind: 'initiative',
    body: {
      name: 'Operating initiative',
      targetDate: '2027-02-20',
      workTypeId: WorkTypeId.parse(published.id),
      blueprint: { creationTeamId: TeamId.parse(f.teamId), optionalChoices: [] },
    },
    invocation: { origin: originFor('initiative_create', {}, appProvenance()) },
  });
  if (created.root.kind !== 'initiative') throw new Error('Missing Initiative root');
  return { ...f, initiative: created.root, created: created.created };
}
describe('affected ordinary reflow bounds and civil completion', () => {
  it.each(['program', 'project'] as const)(
    'finds a generated %s child through its real Initiative relationship during ordinary completion',
    async (kind) => {
      const f = await initiativeAncestryFixture();
      const parent = f.created.find((work) => work.kind === kind);
      const child = f.created.find(
        (work) => work.kind === 'task' && work.row.title === `${kind} child`,
      );
      const dependent = f.created.find(
        (work) => work.kind === 'task' && work.row.title === `${kind} dependent`,
      );
      if (!parent || child?.kind !== 'task' || dependent?.kind !== 'task')
        throw new Error('Missing generated branch');
      expect(parent.row.blueprintState).toBeNull();
      expect(parent.row).toMatchObject({
        blueprintParentKind: 'initiative',
        blueprintParentId: f.initiative.id,
      });
      const prepared = await schema.db.transaction((tx) =>
        prepareBlueprintReflow(tx, f.caller, { kind: 'task', id: child.id }, { state: 'done' }),
      );
      expect(prepared?.snapshot.root).toMatchObject({ kind: 'initiative', id: f.initiative.id });
      const before = one(
        await schema.db
          .select()
          .from(schema.initiative)
          .where(eq(schema.initiative.id, f.initiative.id)),
      );
      const app = appWithActor(tasks, f.orgId, ['manage'], f.humanActorId);
      const response = await app.request(`/${child.id}/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: 'done' }),
      });
      expect(response.status).toBe(200);
      const completed = one(
        await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id)),
      );
      expect(completed.completedAt).not.toBeNull();
      const expected = new Date(completed.completedAt?.toISOString() ?? '');
      expected.setUTCDate(expected.getUTCDate() + 1);
      expect(
        one(await schema.db.select().from(schema.task).where(eq(schema.task.id, dependent.id)))
          .dueDate,
      ).toEqual(new Date(expected.toISOString().slice(0, 10)));
      expect(
        one(
          await schema.db
            .select()
            .from(schema.initiative)
            .where(eq(schema.initiative.id, f.initiative.id)),
        ),
      ).toEqual(before);
    },
  );

  it.each(['program', 'project'] as const)(
    'does not treat a detached generated %s as still physically owned by its original Initiative',
    async (kind) => {
      const f = await initiativeAncestryFixture();
      const parent = f.created.find((work) => work.kind === kind);
      const child = f.created.find(
        (work) => work.kind === 'task' && work.row.title === `${kind} child`,
      );
      const dependent = f.created.find(
        (work) => work.kind === 'task' && work.row.title === `${kind} dependent`,
      );
      if (!parent || child?.kind !== 'task' || dependent?.kind !== 'task')
        throw new Error('Missing generated branch');
      if (kind === 'program')
        await schema.db
          .delete(schema.initiativeProgram)
          .where(eq(schema.initiativeProgram.programId, parent.id));
      else
        await schema.db
          .delete(schema.initiativeProject)
          .where(eq(schema.initiativeProject.projectId, parent.id));
      const prepared = await schema.db.transaction((tx) =>
        prepareBlueprintReflow(tx, f.caller, { kind: 'task', id: child.id }, { state: 'done' }),
      );
      expect(prepared?.snapshot.root).toMatchObject({ kind, id: parent.id });
      const before = one(
        await schema.db
          .select()
          .from(schema.initiative)
          .where(eq(schema.initiative.id, f.initiative.id)),
      );
      const app = appWithActor(tasks, f.orgId, ['manage'], f.humanActorId);
      const response = await app.request(`/${child.id}/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: 'done' }),
      });
      expect(response.status).toBe(200);
      const completed = one(
        await schema.db.select().from(schema.task).where(eq(schema.task.id, child.id)),
      );
      expect(completed.completedAt).not.toBeNull();
      const expected = new Date(completed.completedAt?.toISOString() ?? '');
      expected.setUTCDate(expected.getUTCDate() + 1);
      expect(
        one(await schema.db.select().from(schema.task).where(eq(schema.task.id, dependent.id)))
          .dueDate,
      ).toEqual(new Date(expected.toISOString().slice(0, 10)));
      expect(
        one(
          await schema.db
            .select()
            .from(schema.initiative)
            .where(eq(schema.initiative.id, f.initiative.id)),
        ),
      ).toEqual(before);
    },
  );

  it('rolls back an anchor when its managed offsets would leave the supported civil-date range', async () => {
    const f = await reflowFixture(schema);
    const before = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const app = appWithActor(projects, f.orgId, ['manage'], f.humanActorId);
    const response = await app.request(`/${f.root.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ targetDate: '1970-01-01' }),
    });
    expect(response.status).toBe(422);
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(f.root.targetDate);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toEqual(before);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toEqual(receipts);
  });
  it('does not count 501 unrelated manual siblings against one completion dependent', async () => {
    const f = await reflowFixture(schema);
    await manualChildren(f, 501);
    const prepare = f.byPath.get('prepare'),
      finish = f.byPath.get('finish');
    if (!prepare || !finish) throw new Error('Missing Task fixture');
    const app = appWithActor(tasks, f.orgId, ['manage'], f.humanActorId);
    const response = await app.request(`/${prepare.id}/state`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'done' }),
    });
    expect(response.status).toBe(200);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, finish.id))).dueDate,
    ).not.toBeNull();
  });
  it('refuses 501 affected descendants and rolls back anchor, bindings and receipt', async () => {
    const f = await reflowFixture(schema);
    await manualChildren(f, 497);
    const app = appWithActor(projects, f.orgId, ['manage'], f.humanActorId);
    const response = await app.request(`/${f.root.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ targetDate: '2026-11-27' }),
    });
    expect(response.status).toBe(422);
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(f.root.targetDate);
    expect(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
  it('allows exactly 500 affected descendants', async () => {
    const f = await reflowFixture(schema);
    await manualChildren(f, 496);
    const app = appWithActor(projects, f.orgId, ['manage'], f.humanActorId);
    expect(
      (
        await app.request(`/${f.root.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ targetDate: '2026-11-27' }),
        })
      ).status,
    ).toBe(200);
  });
  it('converts the actual completion instant exactly once in the saved generation timezone', async () => {
    const f = await reflowFixture(schema, 'America/Los_Angeles');
    const prepare = f.byPath.get('prepare'),
      finish = f.byPath.get('finish');
    if (!prepare || !finish) throw new Error('Missing Task fixture');
    await schema.db
      .update(schema.task)
      .set({
        state: 'done',
        statusId: f.statusId('task', 'done'),
        completedAt: new Date('2026-11-03T01:00:00Z'),
      })
      .where(eq(schema.task.id, prepare.id));
    const { prepareBlueprintReflow, applyBlueprintReflow } =
      await import('../../src/lib/work-template-blueprints/reflow');
    await schema.db.transaction(async (tx) => {
      const prepared = await prepareBlueprintReflow(
        tx,
        f.caller,
        { kind: 'task', id: prepare.id },
        { state: 'done' },
      );
      await applyBlueprintReflow(tx, prepared);
    });
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, finish.id)))
        .dueDate?.toISOString()
        .slice(0, 10),
    ).toBe('2026-11-03');
  });
});
