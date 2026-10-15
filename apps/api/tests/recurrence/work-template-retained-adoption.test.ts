import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { getDb, seedTask } from '../support/routes-harness';
import { retainedFixture } from './work-template-adapter-fixture';
import { authorizeRetainedOccurrence } from '../../src/lib/work-creation/retained-authority';
import { loadRetainedBlueprintRoot } from '../../src/lib/work-template-blueprints/retained';
import { retainedOccurrenceCommand } from '../../src/lib/recurrence/work-template-command';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
describe('retained source-map adoption', () => {
  it('keeps an existing root actual body, assignments and explicit manual null date, excluding hand-added children', async () => {
    const f = await retainedFixture(schema);
    const root = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Manually renamed',
      description: 'Private edited body',
      state: 'todo',
      dueDate: null,
      assigneeId: f.humanActorId,
      createdBy: f.humanActorId,
    });
    await schema.db.insert(schema.processInstanceTask).values({
      organizationId: f.orgId,
      instanceId: f.instance.id,
      stepId: f.step.id,
      taskId: root.id,
    });
    await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Hand addition',
      parentTaskId: root.id,
      state: 'todo',
      createdBy: f.humanActorId,
    });
    const adopted = await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      return loadRetainedBlueprintRoot(tx, { authority: facts.authority, rootKey: 'report' });
    });
    expect(adopted.existingByPath.size).toBe(1);
    expect(adopted.root).toMatchObject({
      kind: 'task',
      fields: { title: 'Manually renamed', description: 'Private edited body' },
      responsibleActorId: f.humanActorId,
      dates: { dueDate: null },
    });
    expect(adopted.idsByPath.get('[]')).toBe(root.id);
    expect(adopted.overrides[0]).toMatchObject({
      path: [],
      fields: { title: 'Manually renamed' },
      dates: { dueDate: null },
    });
  });
  it('prepares the original exact fresh root selection and schedule defaults without inserting work', async () => {
    const f = await retainedFixture(schema);
    const result = await schema.db.transaction(async (tx) => {
      const facts = await authorizeRetainedOccurrence(tx, f.request);
      const adopted = await loadRetainedBlueprintRoot(tx, {
        authority: facts.authority,
        rootKey: 'report',
      });
      const command = await retainedOccurrenceCommand(tx, facts.authority);
      return { adopted, command };
    });
    expect(result.adopted.root).toBeNull();
    expect(result.adopted.existingByPath.size).toBe(0);
    expect(result.command.roots[0]?.command.body).toMatchObject({
      title: 'Report',
      teamId: f.teamId,
      dueDate: '2026-10-14',
      workTypeId: f.published.id,
      workTypeVersionId: f.published.latestPublishedVersionId,
    });
  });
});
