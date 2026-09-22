/**
 * Change-set recording and the reverse replay: undo reverts what still matches and reports what it
 * could not take back, entry by entry.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as ChangeSetModule from '../../src/mcp/change-set';
import { one, seedInitiative, seedProgram } from '../support/routes-harness';
import {
  changeSetModules,
  isUndone,
  labelsOf,
  makeLabel,
  makeProject,
  makeTask,
  record,
  seedRawChangeSet,
  seedWorkspace,
} from './change-set-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let changeSets!: typeof ChangeSetModule;
let origin!: Awaited<ReturnType<typeof changeSetModules>>['origin'];

beforeAll(async () => {
  ({ schema, db, changeSets, origin } = await changeSetModules());
});

/** Read one task row. */
async function taskRow(id: string): Promise<typeof DbModule.task.$inferSelect> {
  return one(await db.select().from(schema.task).where(eq(schema.task.id, id)));
}

/** Read one project row. */
async function projectRow(id: string): Promise<typeof DbModule.project.$inferSelect> {
  return one(await db.select().from(schema.project).where(eq(schema.project.id, id)));
}

describe('change-set recording', () => {
  it('records nothing inside a caller transaction when no change was made', async () => {
    const org = await seedWorkspace();
    const id = await db.transaction((tx) =>
      changeSets.recordChangeSetInTx(tx, {
        orgId: org.orgId,
        actorId: org.humanActorId,
        origin: origin(),
        summary: 'Nothing changed',
        changes: [],
      }),
    );

    expect(id).toBeNull();
    const rows = await db
      .select()
      .from(schema.changeSet)
      .where(eq(schema.changeSet.organizationId, org.orgId));
    expect(rows).toHaveLength(0);
  });

  it('records an archive without an after-state and undo reopens the project', async () => {
    const org = await seedWorkspace();
    const project = await makeProject(org);
    await db
      .update(schema.project)
      .set({ archivedAt: new Date() })
      .where(eq(schema.project.id, project.id));
    const changeSetId = await record(org, [
      { kind: 'project', id: project.id, op: 'archive', before: { archivedAt: null } },
    ]);
    const entry = one(
      await db
        .select()
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, changeSetId)),
    );
    expect(entry).toMatchObject({ op: 'archive', after: null });

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([{ kind: 'project', id: project.id, reverted: true }]);
    expect((await projectRow(project.id)).archivedAt).toBeNull();
  });
});

describe('undoChangeSet relation reversal', () => {
  it('restores every relation kind an unlink removed', async () => {
    const org = await seedWorkspace();
    const [first, second] = [await makeTask(org, 'First'), await makeTask(org, 'Second')].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    if (!first || !second) throw new Error('tasks were not seeded');
    const blockingProject = await makeProject(org, 'Blocking');
    const blockedProject = await makeProject(org, 'Blocked');
    const labelId = await makeLabel(org, 'Restored');
    const programRow = await seedProgram(db, schema, org.statusId, {
      organizationId: org.orgId,
      name: 'Program',
      createdBy: org.humanActorId,
    });
    const initiativeRow = await seedInitiative(db, schema, org.statusId, {
      organizationId: org.orgId,
      name: 'Initiative',
      createdBy: org.humanActorId,
    });
    const changeSetId = await record(org, [
      { kind: 'blocks', from: first.id, to: second.id, linked: false },
      {
        kind: 'project_blocks',
        from: blockingProject.id,
        to: blockedProject.id,
        linked: false,
      },
      { kind: 'task_has_label', from: first.id, to: labelId, linked: false },
      { kind: 'project_has_label', from: blockingProject.id, to: labelId, linked: false },
      { kind: 'related_task', from: first.id, to: second.id, linked: false },
      { kind: 'program_contributes_to', from: programRow.id, to: initiativeRow.id, linked: false },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toHaveLength(6);
    expect(outcomes.every((outcome) => outcome.reverted)).toBe(true);
    expect(
      await db
        .select()
        .from(schema.taskDependency)
        .where(eq(schema.taskDependency.blockingTaskId, first.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.projectDependency)
        .where(eq(schema.projectDependency.blockingProjectId, blockingProject.id)),
    ).toHaveLength(1);
    expect(await labelsOf(first.id)).toEqual([labelId]);
    expect(
      await db
        .select()
        .from(schema.projectLabel)
        .where(eq(schema.projectLabel.projectId, blockingProject.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.taskRelatedTask)
        .where(eq(schema.taskRelatedTask.taskId, first.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.initiativeProgram)
        .where(
          and(
            eq(schema.initiativeProgram.programId, programRow.id),
            eq(schema.initiativeProgram.initiativeId, initiativeRow.id),
          ),
        ),
    ).toHaveLength(1);
    expect(await isUndone(changeSetId)).toBe(true);
  });

  it('skips a relation entry that recorded no endpoints', async () => {
    const org = await seedWorkspace();
    const changeSetId = await seedRawChangeSet(org, [
      { entityKind: 'blocks', entityId: 'a:b', op: 'link', before: null, after: {} },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'blocks', id: 'a:b', reverted: false, reason: 'no_endpoints' },
    ]);
  });
});

describe('undoChangeSet task reversal', () => {
  it('reports a task that no longer exists as gone', async () => {
    const org = await seedWorkspace();
    const changeSetId = await seedRawChangeSet(org, [
      {
        entityKind: 'task',
        entityId: 'task_missing',
        op: 'update',
        before: { title: 'Old' },
        after: { title: 'New' },
      },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'task', id: 'task_missing', reverted: false, reason: 'gone' },
    ]);
  });

  it('leaves a task alone when the entry is a legacy archive with no prior state', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const changeSetId = await seedRawChangeSet(org, [
      { entityKind: 'task', entityId: row.id, op: 'archive', before: null, after: null },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'task', id: row.id, reverted: false, reason: 'no_prior_state' },
    ]);
  });

  it('leaves a task alone when the prior state has no workflow status', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org, 'Current');
    const after = changeSets.trackedFields('task', row);
    const changeSetId = await record(org, [
      {
        kind: 'task',
        id: row.id,
        op: 'update',
        before: { ...after, title: 'Prior', statusId: null },
        after,
      },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'task', id: row.id, reverted: false, reason: 'no_prior_state' },
    ]);
    expect((await taskRow(row.id)).title).toBe('Current');
  });

  it('leaves a task alone when the prior parent is not a task id', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const after = changeSets.trackedFields('task', row);
    const changeSetId = await record(org, [
      { kind: 'task', id: row.id, op: 'update', before: { ...after, parentTaskId: 7 }, after },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'task', id: row.id, reverted: false, reason: 'no_prior_state' },
    ]);
  });

  it('re-archives a task whose recorded prior state was archived', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org, 'Unarchived');
    const after = changeSets.trackedFields('task', row);
    const archivedAt = '2026-01-15T12:00:00.000Z';
    const changeSetId = await record(org, [
      { kind: 'task', id: row.id, op: 'update', before: { ...after, archivedAt }, after },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([{ kind: 'task', id: row.id, reverted: true }]);
    expect((await taskRow(row.id)).archivedAt?.toISOString()).toBe(archivedAt);
  });

  it('refuses a recorded archive timestamp that is not a string', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const after = changeSets.trackedFields('task', row);
    const changeSetId = await record(org, [
      { kind: 'task', id: row.id, op: 'update', before: { ...after, archivedAt: 42 }, after },
    ]);

    await expect(changeSets.undoChangeSet(org.orgId, changeSetId)).rejects.toBeInstanceOf(Error);
    expect(await isUndone(changeSetId)).toBe(false);
  });

  it('refuses a recorded archive timestamp that is not a date', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const after = changeSets.trackedFields('task', row);
    const changeSetId = await record(org, [
      {
        kind: 'task',
        id: row.id,
        op: 'update',
        before: { ...after, archivedAt: 'not-a-date' },
        after,
      },
    ]);

    await expect(changeSets.undoChangeSet(org.orgId, changeSetId)).rejects.toBeInstanceOf(Error);
    expect((await taskRow(row.id)).archivedAt).toBeNull();
  });
});

describe('undoChangeSet entity reversal', () => {
  it('reports a project that no longer exists in the organization as gone', async () => {
    const org = await seedWorkspace();
    const changeSetId = await seedRawChangeSet(org, [
      {
        entityKind: 'project',
        entityId: 'project_missing',
        op: 'update',
        before: { name: 'Old' },
        after: { name: 'New' },
      },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'project', id: 'project_missing', reverted: false, reason: 'gone' },
    ]);
  });

  it('skips a project someone edited after the change', async () => {
    const org = await seedWorkspace();
    const project = await makeProject(org, 'Renamed by someone else');
    const changeSetId = await record(org, [
      {
        kind: 'project',
        id: project.id,
        op: 'update',
        before: { name: 'Original' },
        after: { name: 'Renamed by the tool' },
      },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'project', id: project.id, reverted: false, reason: 'changed_since' },
    ]);
    expect((await projectRow(project.id)).name).toBe('Renamed by someone else');
  });

  it('skips a project update that recorded no prior state', async () => {
    const org = await seedWorkspace();
    const project = await makeProject(org, 'Current');
    const changeSetId = await seedRawChangeSet(org, [
      {
        entityKind: 'project',
        entityId: project.id,
        op: 'update',
        before: null,
        after: { name: 'Current' },
      },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'project', id: project.id, reverted: false, reason: 'no_prior_state' },
    ]);
  });

  it('skips a project entry recorded with a relation operation', async () => {
    const org = await seedWorkspace();
    const project = await makeProject(org);
    const changeSetId = await seedRawChangeSet(org, [
      { entityKind: 'project', entityId: project.id, op: 'link', before: null, after: null },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'project', id: project.id, reverted: false, reason: 'unsupported_op' },
    ]);
  });

  it('skips a task-label snapshot, which only the atomic undo can reverse', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const changeSetId = await record(org, [
      { kind: 'task_labels', taskId: row.id, before: [], after: [] },
    ]);

    const { outcomes } = await changeSets.undoChangeSet(org.orgId, changeSetId);

    expect(outcomes).toEqual([
      { kind: 'task_labels', id: row.id, reverted: false, reason: 'unsupported_kind' },
    ]);
  });
});
