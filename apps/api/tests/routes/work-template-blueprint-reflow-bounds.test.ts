import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import projects from '../../src/routes/projects';
import tasks from '../../src/routes/tasks';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
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
describe('affected ordinary reflow bounds and civil completion', () => {
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
