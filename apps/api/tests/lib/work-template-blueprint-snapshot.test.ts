import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { NotFoundError } from '../../src/error';
import { loadBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot';
import { getDb, one, seedProject, seedTask, seedTaskAccessOrg } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'contribute');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['contribute'],
  };
  const root = await seedProject(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Community dinner',
    description: '## Authored outline',
    summary: null,
    teamId: base.teamId,
    status: 'planned',
    targetDate: new Date('2026-11-20'),
    createdBy: base.humanActorId,
  });
  const checkpoint = one(
    await schema.db
      .insert(schema.milestone)
      .values({
        organizationId: base.orgId,
        projectId: root.id,
        name: 'Venue',
        targetDate: new Date('2026-11-18'),
        createdBy: base.humanActorId,
      })
      .returning(),
  );
  const task = await seedTask(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    teamId: base.teamId,
    title: 'Confirm venue',
    description: 'Edited task body',
    projectId: root.id,
    milestoneId: checkpoint.id,
    assigneeId: base.humanActorId,
    dueDate: new Date('2026-11-17'),
    state: 'todo',
    createdBy: base.humanActorId,
  });
  const nested = await seedTask(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    teamId: base.teamId,
    title: 'Send confirmation',
    projectId: root.id,
    milestoneId: checkpoint.id,
    parentTaskId: task.id,
    state: 'todo',
    createdBy: base.humanActorId,
  });
  return { ...base, caller, root, checkpoint, task, nested };
}

describe('authorized concrete blueprint snapshots', () => {
  it('reads authored and manual work with current physical parents and civil dates', async () => {
    const f = await fixture();
    const snapshot = await schema.db.transaction((tx) =>
      loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
    );
    expect(snapshot.root).toMatchObject({
      id: f.root.id,
      kind: 'project',
      fields: { description: '## Authored outline', summary: null },
      dates: { targetDate: '2026-11-20' },
    });
    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.nodes.find((node) => node.id === f.task.id)).toMatchObject({
      parentId: f.checkpoint.id,
      fields: { description: 'Edited task body' },
      dates: { dueDate: '2026-11-17' },
      sourceStepId: null,
    });
    expect(snapshot.nodes.find((node) => node.id === f.nested.id)).toMatchObject({
      parentId: f.task.id,
    });
    expect(snapshot.rowsByRef.get(`task:${f.task.id}`)).toMatchObject({
      kind: 'task',
      row: { projectId: f.root.id, milestoneId: f.checkpoint.id },
    });
  });

  it('refuses foreign roots without returning work prose', async () => {
    const f = await fixture();
    const foreign = await seedTaskAccessOrg(schema.db, schema, 'contribute');
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(
          tx,
          { ...f.caller, orgId: foreign.orgId, actorId: foreign.humanActorId },
          { kind: 'project', id: f.root.id },
          { scope: 'tree' },
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fails closed for a hidden required descendant rather than copying its body', async () => {
    const f = await fixture();
    // The default harness grants organization-wide access, including private descendants.
    // Use public baseline read access here so this child is actually hidden.
    await schema.db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'PRIVATE CHILD TITLE',
      description: 'PRIVATE CHILD BODY',
      projectId: f.root.id,
      state: 'todo',
      visibility: 'private',
    });
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses oversized capture instead of returning a truncated tree', async () => {
    const f = await fixture();
    await schema.db.insert(schema.task).values(
      Array.from({ length: 497 }, (_, index) => ({
        organizationId: f.orgId,
        teamId: f.teamId,
        projectId: f.root.id,
        title: `Manual ${index}`,
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })),
    );
    await expect(
      schema.db.transaction((tx) =>
        loadBlueprintSnapshot(tx, f.caller, { kind: 'project', id: f.root.id }, { scope: 'tree' }),
      ),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
  });
});
