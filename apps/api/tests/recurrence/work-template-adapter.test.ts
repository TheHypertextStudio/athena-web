import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { getDb, seedTask } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { materializeTemplateOccurrence } from '../../src/lib/recurrence/work-template-adapter';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
describe('shared recurrence creation adopter', () => {
  it('creates an exact pinned root once and retains the original occurrence/source maps on retry', async () => {
    const f = await retainedFixture(schema);
    const first = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    const second = await schema.db.transaction((tx) =>
      materializeTemplateOccurrence(tx, f.request),
    );
    expect(first.result.taskIdsByKey['report']).toBeDefined();
    expect(second.result).toEqual(first.result);
    expect(second.delta.createdTaskIdsByKey).toEqual({});
    expect(second.effects).toEqual([]);
    const rows = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
      dueDate: new Date('2026-10-14'),
    });
  });
  it('adopts existing edited work without replacing its body or manually cleared schedule date', async () => {
    const f = await retainedFixture(schema);
    const actual = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Actual title',
      description: 'Actual body',
      state: 'todo',
      dueDate: null,
      createdBy: f.humanActorId,
    });
    await schema.db.insert(schema.processInstanceTask).values({
      organizationId: f.orgId,
      instanceId: f.instance.id,
      stepId: f.step.id,
      taskId: actual.id,
    });
    const result = await schema.db.transaction((tx) =>
      materializeTemplateOccurrence(tx, f.request),
    );
    expect(result.result.taskIdsByKey['report']).toBe(actual.id);
    expect(result.delta.createdTaskIdsByKey).toEqual({});
    const rows = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Actual title',
      description: 'Actual body',
      dueDate: null,
    });
  });
  it('allows only the registered nullable creator and lawful archived exact publication', async () => {
    const f = await retainedFixture(schema);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.series.id));
    await schema.db
      .update(schema.template)
      .set({ publicationState: 'archived', archivedAt: new Date() })
      .where(eq(schema.template.id, f.published.id));
    const result = await schema.db.transaction((tx) =>
      materializeTemplateOccurrence(tx, f.request),
    );
    expect(result.result.taskIdsByKey['report']).toBeDefined();
    const rows = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(rows[0]?.createdBy).toBeNull();
  });
  it('never resurrects a removed extra template child after the full occurrence application', async () => {
    const definition = WorkTemplateDefinition.parse({
      name: 'Report with review',
      payload: { targetType: 'task', title: 'Report' },
      blueprint: {
        steps: [
          {
            key: 'review',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            optional: { enabled: false, selectedByDefault: true },
            template: null,
            fields: { title: 'Review' },
            teamRule: 'parent_team',
            actorRule: 'unassigned',
            cycleRule: 'none',
            dates: {},
          },
        ],
        dependencies: [],
      },
    });
    const f = await retainedFixture(schema, false, undefined, definition);
    const first = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    const rows = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(rows).toHaveLength(2);
    const child = rows.find((row) => row.id !== first.result.taskIdsByKey['report']);
    if (!child) throw new Error('Missing generated child');
    await schema.db.delete(schema.task).where(eq(schema.task.id, child.id));
    const retry = await schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request));
    expect(retry.effects).toEqual([]);
    expect(retry.delta.createdTaskIdsByKey).toEqual({});
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
  it('refuses pending drafts before materializing any work', async () => {
    const f = await retainedFixture(schema, true);
    await expect(
      schema.db.transaction((tx) => materializeTemplateOccurrence(tx, f.request)),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toEqual([]);
  });
});
