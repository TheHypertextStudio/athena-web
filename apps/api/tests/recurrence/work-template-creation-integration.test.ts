import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { getDb, seedTask } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
import { authorizeRetainedOccurrence } from '../../src/lib/work-creation/retained-authority';
import { retainedOccurrenceCommand } from '../../src/lib/recurrence/work-template-command';
import { createWorkBatchInTransaction } from '../../src/lib/work-creation/service';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function createOccurrence(f: Awaited<ReturnType<typeof retainedFixture>>) {
  return schema.db.transaction(async (tx) => {
    const facts = await authorizeRetainedOccurrence(tx, f.request);
    return createWorkBatchInTransaction(tx, await retainedOccurrenceCommand(tx, facts.authority));
  });
}
describe('canonical retained occurrence creation', () => {
  it.each([false, true])(
    'preserves an archived-team root but refuses new work assigned there (children: %s)',
    async (children) => {
      const definition = WorkTemplateDefinition.parse({
        name: 'Report',
        payload: { targetType: 'task', title: 'Report' },
        blueprint: {
          steps: children
            ? [
                BlueprintStep.parse({
                  key: 'review',
                  kind: 'task',
                  parentStepKey: null,
                  sort: 0,
                  fields: { title: 'Review' },
                  template: null,
                  optional: { enabled: false, selectedByDefault: true },
                  teamRule: 'parent_team',
                  actorRule: 'unassigned',
                  cycleRule: 'none',
                  dates: {},
                }),
              ]
            : [],
          dependencies: [],
        },
      });
      const f = await retainedFixture(schema, false, undefined, definition);
      const root = await seedTask(schema.db, schema, f.statusId, {
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Preserve me',
        state: 'todo',
        createdBy: f.humanActorId,
      });
      await schema.db.insert(schema.processInstanceTask).values({
        organizationId: f.orgId,
        instanceId: f.instance.id,
        stepId: f.step.id,
        taskId: root.id,
      });
      await schema.db
        .update(schema.team)
        .set({ archivedAt: new Date() })
        .where(eq(schema.team.id, f.teamId));
      if (children) await expect(createOccurrence(f)).rejects.toMatchObject({ status: 404 });
      else expect((await createOccurrence(f)).created).toHaveLength(0);
      expect(
        await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
      ).toHaveLength(1);
    },
  );
  it('creates the exact archived publication with its original trigger-relative root date', async () => {
    const f = await retainedFixture(schema);
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, f.published.id));
    const result = await createOccurrence(f);
    expect(result.created).toHaveLength(1);
    const work = result.rootsByKey.get('report');
    expect(work?.kind).toBe('task');
    if (work?.kind !== 'task') throw new Error('Expected Task');
    expect(work.row).toMatchObject({
      title: 'Report',
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
    expect(work.row.dueDate?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
  it.each(['todo', 'done'] as const)(
    'adopts an existing %s root and adds only its missing template child without changing history',
    async (state) => {
      const definition = WorkTemplateDefinition.parse({
        name: 'Report with review',
        payload: { targetType: 'task', title: 'Report' },
        blueprint: {
          steps: [
            BlueprintStep.parse({
              key: 'review',
              kind: 'task',
              parentStepKey: null,
              sort: 0,
              fields: { title: 'Review report' },
              template: null,
              optional: { enabled: false, selectedByDefault: true },
              teamRule: 'parent_team',
              actorRule: 'parent_responsible',
              cycleRule: 'parent_cycle',
              dates: {},
            }),
          ],
          dependencies: [],
        },
      });
      const f = await retainedFixture(schema, false, undefined, definition);
      const root = await seedTask(schema.db, schema, f.statusId, {
        organizationId: f.orgId,
        teamId: f.teamId,
        title: 'Manual report',
        description: 'Keep my edits',
        dueDate: null,
        assigneeId: f.humanActorId,
        state,
        ...(state === 'done'
          ? { completedAt: new Date('2026-10-12T12:00:00Z'), autoCompletedBySubtasks: true }
          : {}),
        createdBy: f.humanActorId,
      });
      await schema.db.insert(schema.processInstanceTask).values({
        organizationId: f.orgId,
        instanceId: f.instance.id,
        stepId: f.step.id,
        taskId: root.id,
      });
      const result = await createOccurrence(f);
      expect(result.created).toHaveLength(1);
      expect(result.rootsByKey.get('report')?.id).toBe(root.id);
      const [child] = result.created;
      expect(child?.kind).toBe('task');
      if (child?.kind !== 'task') throw new Error('Expected generated Task');
      expect(child.row).toMatchObject({
        title: 'Review report',
        parentTaskId: root.id,
        assigneeId: f.humanActorId,
      });
      const [saved] = await schema.db.select().from(schema.task).where(eq(schema.task.id, root.id));
      expect(saved).toMatchObject({
        title: 'Manual report',
        description: 'Keep my edits',
        dueDate: null,
        statusId: root.statusId,
        completedAt: root.completedAt,
        updatedAt: root.updatedAt,
      });
    },
  );
});
