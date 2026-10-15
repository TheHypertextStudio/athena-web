import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { getDb, one, seedTask } from '../support/routes-harness';
import { reflowFixture } from './work-template-blueprint-reflow-fixture';
import { loadBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
describe('accepted blueprint snapshot bindings', () => {
  it('resolves immutable accepted sibling keys to physical completion and Milestone facts', async () => {
    const f = await reflowFixture(schema);
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(
        tx,
        f.caller,
        { kind: 'project', id: f.root.id },
        { scope: 'tree', forUpdate: true, access: 'edit' },
      ),
    );
    const prepare = f.byPath.get('prepare');
    const checkpoint = f.byPath.get('checkpoint');
    const finish = f.byPath.get('finish');
    const followup = f.byPath.get('milestone_task');
    expect(
      snapshot.nodes.find((node) => node.id === finish?.id)?.dateReferences?.dueDate,
    ).toMatchObject({ parentId: f.root.id, completionIds: { prepare: prepare?.id } });
    expect(
      snapshot.nodes.find((node) => node.id === followup?.id)?.dateReferences?.dueDate,
    ).toMatchObject({ milestoneIds: { checkpoint: checkpoint?.id } });
    expect(snapshot.context.timezone).toBe(f.root.blueprintState?.creationTimezone);
  });
  it('allows complete source locking for a viewer but requires live edit rights when requested', async () => {
    const f = await reflowFixture(schema);
    await schema.db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          f.caller,
          { kind: 'project', id: f.root.id },
          { scope: 'tree', forUpdate: true },
        ),
      ),
    ).resolves.toMatchObject({ root: { id: f.root.id } });
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          f.caller,
          { kind: 'project', id: f.root.id },
          { scope: 'tree', forUpdate: true, access: 'edit' },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('retains opaque immutable creation paths while excluding a physically moved child', async () => {
    const f = await reflowFixture(schema);
    const generated = f.byPath.get('prepare');
    if (generated?.kind !== 'task') throw new Error('Expected generated Task');
    const other = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Elsewhere',
      state: 'todo',
    });
    await schema.db
      .update(schema.task)
      .set({ projectId: null, parentTaskId: other.id })
      .where(eq(schema.task.id, generated.id));
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
    );
    expect(snapshot.nodes.some((node) => node.id === generated.id)).toBe(false);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, generated.id)))
        .blueprintPath,
    ).toEqual(['prepare']);
  });
});
