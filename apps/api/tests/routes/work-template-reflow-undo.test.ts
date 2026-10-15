import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  createWorkTemplate,
  publishWorkTemplate,
  archiveWorkTemplate,
} from '../../src/lib/templates/service';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { desc, eq } from 'drizzle-orm';
import { appWithActor, getDb, one } from '../support/routes-harness';
import { reflowFixture } from '../lib/work-template-blueprint-reflow-fixture';
import { undoChangeSetAtomically, undoChangeSet } from '../../src/mcp/change-set';
import { unchangedSince, restoredWorkSnapshot } from '../../src/mcp/change-set-values';
import projects from '../../src/routes/projects';
import tasks from '../../src/routes/tasks';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
const headers = { 'content-type': 'application/json' };
async function lastReceipt(orgId: string) {
  return one(
    await schema.db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, orgId))
      .orderBy(desc(schema.changeSet.id))
      .limit(1),
  );
}
describe('accepted date ownership and existing undo', () => {
  it('compares JSON ownership by value regardless of jsonb key order', () => {
    expect(
      unchangedSince(
        { blueprintDateBindings: { dueDate: { manual: false, rule: { kind: 'none' } } } },
        { blueprintDateBindings: { dueDate: { rule: { kind: 'none' }, manual: false } } },
      ),
    ).toBe(true);
    expect(
      unchangedSince(
        { blueprintDateBindings: { dueDate: { manual: true } } },
        { blueprintDateBindings: { dueDate: { manual: false } } },
      ),
    ).toBe(false);
  });
  it('ignores receipt pointers but retains dependency ownership and advances restored revision', () => {
    const old = {
      revision: 2,
      lastApplicationChangeSetId: 'old',
      managedDependencies: [{ blockerId: 'a', blockedId: 'b' }],
    };
    const current = { revision: 3, lastApplicationChangeSetId: 'new', managedDependencies: [] };
    expect(
      unchangedSince(
        { blueprintState: old },
        { blueprintState: { ...old, lastApplicationChangeSetId: 'other' } },
      ),
    ).toBe(true);
    expect(unchangedSince({ blueprintState: old }, { blueprintState: current })).toBe(false);
    expect(
      restoredWorkSnapshot({ blueprintState: old }, { blueprintState: current }),
    ).toMatchObject({
      blueprintState: {
        revision: 4,
        lastApplicationChangeSetId: null,
        managedDependencies: old.managedDependencies,
      },
    });
  });
  it('records and undoes a same-value manual pin without altering the date or authored body', async () => {
    const f = await reflowFixture(schema),
      prepare = f.byPath.get('prepare');
    if (prepare?.kind !== 'task') throw new Error('Missing Task');
    const app = appWithActor(tasks, f.orgId, ['manage'], f.humanActorId);
    const response = await app.request(`/${prepare.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ dueDate: prepare.row.dueDate?.toISOString().slice(0, 10) }),
    });
    expect(response.status).toBe(200);
    const receipt = await lastReceipt(f.orgId);
    expect(receipt.origin).toMatchObject({ tool: 'update_task' });
    const result = await undoChangeSetAtomically(f.orgId, receipt.id);
    expect(result.outcomes.every((outcome) => outcome.reverted)).toBe(true);
    const restored = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.id, prepare.id)),
    );
    expect(restored.blueprintDateBindings.dueDate?.manual).toBe(false);
    expect(restored.dueDate).toEqual(prepare.row.dueDate);
    expect(restored.description).toBe(prepare.row.description);
  });
  it.each(['task', 'project'] as const)(
    'restores a receipt-bound prior archived %s identity',
    async (kind) => {
      const f = await reflowFixture(schema),
        prepare = f.byPath.get('prepare');
      if (prepare?.kind !== 'task') throw new Error('Missing Task');
      let previous = f.published;
      const id = kind === 'task' ? prepare.id : f.root.id;
      const app = appWithActor(
        kind === 'task' ? tasks : projects,
        f.orgId,
        ['manage'],
        f.humanActorId,
      );
      if (kind === 'task') {
        const draft = await createWorkTemplate(f.caller, {
          targetType: 'task',
          scope: 'personal',
          offeredTeamIds: [],
          definition: WorkTemplateDefinition.parse({
            name: 'Prior task',
            payload: { targetType: 'task', title: 'Prior' },
          }),
        });
        previous = await publishWorkTemplate(f.caller, draft.id, draft.draftRevision);
        expect(
          (
            await app.request(`/${id}/template`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ workTypeId: previous.id }),
            })
          ).status,
        ).toBe(200);
      }
      const bases = await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId));
      const blank = bases.find((row) => row.isBase && row.targetType === kind);
      if (!blank) throw new Error(`Missing base ${kind}`);
      expect(
        (
          await app.request(`/${id}/template`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ workTypeId: blank.id }),
          })
        ).status,
      ).toBe(200);
      const receipt = await lastReceipt(f.orgId);
      await archiveWorkTemplate(f.caller, previous.id);
      const result =
        kind === 'task'
          ? await undoChangeSetAtomically(f.orgId, receipt.id)
          : await undoChangeSet(f.orgId, receipt.id);
      expect(result.outcomes.every((item) => item.reverted)).toBe(true);
      const table = kind === 'task' ? schema.task : schema.project;
      expect(one(await schema.db.select().from(table).where(eq(table.id, id)))).toMatchObject({
        workTypeId: previous.id,
        workTypeVersionId: previous.latestPublishedVersionId,
      });
    },
  );
  it('undoes one Project-anchor receipt together with every managed descendant date/binding', async () => {
    const f = await reflowFixture(schema),
      prepare = f.byPath.get('prepare');
    if (prepare?.kind !== 'task') throw new Error('Missing Task');
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
    const result = await undoChangeSet(f.orgId, (await lastReceipt(f.orgId)).id);
    expect(result.outcomes.every((outcome) => outcome.reverted)).toBe(true);
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(f.root.targetDate);
    const restored = one(
      await schema.db.select().from(schema.task).where(eq(schema.task.id, prepare.id)),
    );
    expect(restored.dueDate).toEqual(prepare.row.dueDate);
    expect(restored.startDate).toEqual(prepare.row.startDate);
    expect(restored.blueprintDateBindings).toEqual(prepare.row.blueprintDateBindings);
  });
});
