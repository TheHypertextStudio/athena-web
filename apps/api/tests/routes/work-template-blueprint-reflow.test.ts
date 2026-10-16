import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import projects from '../../src/routes/projects';
import tasks from '../../src/routes/tasks';
import milestones from '../../src/routes/milestones';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { WorkTemplateChangePreview } from '@docket/work/work-template-reference';
import { editWorkTemplateDraft, publishWorkTemplate } from '../../src/lib/templates/service';
import { flushDeferredWork } from '../../src/lib/after-response';
import { undoChangeSetAtomically } from '../../src/mcp/change-set';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(flushDeferredWork);
const headers = { 'content-type': 'application/json' };
function patch(app: ReturnType<typeof appWithActor>, path: string, body: object) {
  return app.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
}
async function row(id: string) {
  return one(await schema.db.select().from(schema.task).where(eq(schema.task.id, id)));
}
async function checkpointRow(id: string) {
  return one(await schema.db.select().from(schema.milestone).where(eq(schema.milestone.id, id)));
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
  it('accepts and undoes only a reviewed Milestone date while preserving an unselected dependent', async () => {
    const f = await fixture();
    const before = await checkpointRow(f.checkpoint.id);
    const dependent = await row(f.followup.id);
    const definition = WorkTemplateDefinition.parse(f.published.draftDefinition);
    const checkpoint = definition.blueprint.steps.find((step) => step.key === 'checkpoint');
    if (checkpoint?.kind !== 'milestone') throw new Error('Missing checkpoint source');
    checkpoint.dates.targetDate = {
      kind: 'anchor',
      anchor: { kind: 'parent' },
      offset: { days: -1, unit: 'working' },
    };
    const draft = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition,
    });
    await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
    const response = await f.projects.request(`/${f.root.id}/template/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workTypeId: f.published.id, mode: 'update' }),
    });
    expect(response.status).toBe(200);
    const preview = WorkTemplateChangePreview.parse(await response.json());
    const change = preview.childChanges.find(
      (entry) => entry.kind === 'set_derived_date' && entry.path[0] === 'checkpoint',
    );
    expect(change).toMatchObject({
      field: 'targetDate',
      previous: '2026-11-18',
      value: '2026-11-19',
    });
    if (!change) throw new Error('Missing reviewed checkpoint date');
    const accepted = await f.projects.request(`/${f.root.id}/template/update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workTypeId: f.published.id,
        previewToken: preview.previewToken,
        acceptChildChanges: [change.changeId],
      }),
    });
    expect(accepted.status).toBe(200);
    expect((await checkpointRow(f.checkpoint.id)).targetDate).toEqual(new Date('2026-11-19'));
    expect(await row(f.followup.id)).toEqual(dependent);
    const receipts = await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, f.orgId));
    const receipt = one(receipts.filter((entry) => entry.summary === 'Updated template'));
    expect(
      (await undoChangeSetAtomically(f.orgId, receipt.id)).outcomes.every(
        (entry) => entry.reverted,
      ),
    ).toBe(true);
    const restored = await checkpointRow(f.checkpoint.id);
    expect(restored.targetDate).toEqual(before.targetDate);
    expect(restored.blueprintDateBindings).toEqual(before.blueprintDateBindings);
    expect(await row(f.followup.id)).toEqual(dependent);
  });
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
