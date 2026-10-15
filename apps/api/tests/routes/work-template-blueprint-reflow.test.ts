import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import projects from '../../src/routes/projects';
import tasks from '../../src/routes/tasks';
import milestones from '../../src/routes/milestones';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };
function patch(app: ReturnType<typeof appWithActor>, path: string, body: object) {
  return app.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
}
async function row(id: string) {
  return one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
}
async function fixture() {
  const f = await reflowFixture(schema);
  const prepare = f.byPath.get('prepare');
  const finish = f.byPath.get('finish');
  const checkpoint = f.byPath.get('checkpoint');
  const followup = f.byPath.get('milestone_task');
  if (!prepare || !finish || !checkpoint || !followup) throw new Error('Missing generated fixture');
  return {
    ...f,
    prepare,
    finish,
    checkpoint,
    followup,
    projects: appWithActor(projects, f.orgId, ['manage'], f.humanActorId),
    tasks: appWithActor(tasks, f.orgId, ['manage'], f.humanActorId),
    milestones: appWithActor(milestones, f.orgId, ['manage'], f.humanActorId),
  };
}
describe('ordinary blueprint date reflow', () => {
  it('reflows managed children atomically with a Project anchor and one existing receipt', async () => {
    const f = await fixture();
    const before = await row(f.prepare.id);
    expect((await patch(f.projects, `/${f.root.id}`, { targetDate: '2026-11-27' })).status).toBe(
      200,
    );
    const after = await row(f.prepare.id);
    expect(after.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-26');
    expect(after.startDate?.toISOString().slice(0, 10)).toBe('2026-11-23');
    expect(after.description).toBe(before.description);
    expect(after.blueprintStepId).toBe(before.blueprintStepId);
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    expect(receipts).toHaveLength(2); // one creation, one anchor edit with all derived entries
  });
  it('pins a same-value explicit due date while retaining independently managed start timing', async () => {
    const f = await fixture();
    const before = await row(f.prepare.id);
    expect(
      (
        await patch(f.tasks, `/${f.prepare.id}`, {
          dueDate: before.dueDate?.toISOString().slice(0, 10),
        })
      ).status,
    ).toBe(200);
    expect((await row(f.prepare.id)).blueprintDateBindings.dueDate?.manual).toBe(true);
    expect((await patch(f.projects, `/${f.root.id}`, { targetDate: '2026-11-23' })).status).toBe(
      200,
    );
    const after = await row(f.prepare.id);
    expect(after.dueDate).toEqual(before.dueDate);
    expect(after.startDate?.toISOString().slice(0, 10)).toBe('2026-11-17');
  });
  it('keeps explicit null due dates manual across later parent movement', async () => {
    const f = await fixture();
    expect((await patch(f.tasks, `/${f.prepare.id}`, { dueDate: null })).status).toBe(200);
    expect((await patch(f.projects, `/${f.root.id}`, { targetDate: '2026-11-27' })).status).toBe(
      200,
    );
    expect(await row(f.prepare.id)).toMatchObject({
      dueDate: null,
      blueprintDateBindings: { dueDate: { manual: true } },
    });
  });
  it('uses actual completion and clears only managed dependent dates on reopening', async () => {
    const f = await fixture();
    expect(
      (
        await f.tasks.request(`/${f.prepare.id}/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ state: 'done' }),
        })
      ).status,
    ).toBe(200);
    expect((await row(f.finish.id)).dueDate).not.toBeNull();
    expect(
      (
        await f.tasks.request(`/${f.prepare.id}/state`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ state: 'todo' }),
        })
      ).status,
    ).toBe(200);
    expect((await row(f.finish.id)).dueDate).toBeNull();
  });
  it('preserves actual completion and dependent dates without another receipt on repeated completion', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
      expect(
        (
          await f.tasks.request(`/${f.prepare.id}/state`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ state: 'done' }),
          })
        ).status,
      ).toBe(200);
      const first = await row(f.prepare.id),
        dependent = await row(f.finish.id);
      const receipts = await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId));
      vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
      expect(
        (
          await f.tasks.request(`/${f.prepare.id}/state`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ state: 'done' }),
          })
        ).status,
      ).toBe(200);
      expect((await row(f.prepare.id)).completedAt).toEqual(first.completedAt);
      expect((await row(f.finish.id)).dueDate).toEqual(dependent.dueDate);
      expect(
        await schema.db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.organizationId, f.orgId)),
      ).toHaveLength(receipts.length);
    } finally {
      vi.useRealTimers();
    }
  });
  it('reflows an accepted Milestone anchor through the ordinary nested endpoint', async () => {
    const f = await fixture();
    expect(
      (
        await patch(f.milestones, `/${f.root.id}/milestones/${f.checkpoint.id}`, {
          targetDate: '2026-11-25',
        })
      ).status,
    ).toBe(200);
    expect((await row(f.followup.id)).dueDate?.toISOString().slice(0, 10)).toBe('2026-11-26');
  });
});
