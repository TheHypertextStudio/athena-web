/**
 * The atomic expansion undo: it reverses a change set only when every task and label snapshot it
 * recorded still matches, and otherwise refuses without changing anything.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { ConflictError, NotFoundError } from '../../src/error';
import type * as ChangeSetModule from '../../src/mcp/change-set';
import { one } from '../support/routes-harness';
import {
  attachLabel,
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

beforeAll(async () => {
  ({ schema, db, changeSets } = await changeSetModules());
});

describe('undoChangeSetAtomically', () => {
  it('refuses a change set that does not exist', async () => {
    const org = await seedWorkspace();

    await expect(
      changeSets.undoChangeSetAtomically(org.orgId, 'cs_missing'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses when a recorded task no longer exists', async () => {
    const org = await seedWorkspace();
    const changeSetId = await seedRawChangeSet(org, [
      { entityKind: 'task', entityId: 'task_missing', op: 'create', before: null, after: null },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await isUndone(changeSetId)).toBe(false);
  });

  it('refuses a task-label snapshot whose after-state is not a label list', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const changeSetId = await seedRawChangeSet(org, [
      {
        entityKind: 'task_labels',
        entityId: row.id,
        op: 'update',
        before: { labelIds: [] },
        after: { labelIds: 'not-a-list' },
      },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await isUndone(changeSetId)).toBe(false);
  });

  it('refuses when a task lost the labels the change set added', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const labelId = await makeLabel(org, 'Removed later');
    const changeSetId = await record(org, [
      { kind: 'task_labels', taskId: row.id, before: [], after: [labelId] },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await isUndone(changeSetId)).toBe(false);
  });

  it('restores an empty label set by removing every label the change added', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const labelId = await makeLabel(org, 'Added');
    await attachLabel(org, row.id, labelId);
    const changeSetId = await record(org, [
      { kind: 'task_labels', taskId: row.id, before: [], after: [labelId] },
    ]);

    const { outcomes } = await changeSets.undoChangeSetAtomically(org.orgId, changeSetId);

    expect(outcomes).toEqual([{ kind: 'task_labels', id: row.id, reverted: true }]);
    expect(await labelsOf(row.id)).toEqual([]);
    expect(await isUndone(changeSetId)).toBe(true);
  });

  it('puts back the labels a replacement removed', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const original = await makeLabel(org, 'Original');
    const replacement = await makeLabel(org, 'Replacement');
    await attachLabel(org, row.id, replacement);
    const changeSetId = await record(org, [
      { kind: 'task_labels', taskId: row.id, before: [original], after: [replacement] },
    ]);

    await changeSets.undoChangeSetAtomically(org.orgId, changeSetId);

    expect(await labelsOf(row.id)).toEqual([original]);
  });

  it('refuses a task-label snapshot whose before-state is not a label list', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const labelId = await makeLabel(org, 'Kept');
    await attachLabel(org, row.id, labelId);
    const changeSetId = await seedRawChangeSet(org, [
      {
        entityKind: 'task_labels',
        entityId: row.id,
        op: 'update',
        before: { labelIds: [1] },
        after: { labelIds: [labelId] },
      },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await labelsOf(row.id)).toEqual([labelId]);
  });

  it('refuses a task entry that is neither a create nor an update with prior state', async () => {
    const org = await seedWorkspace();
    const row = await makeTask(org);
    const changeSetId = await seedRawChangeSet(org, [
      { entityKind: 'task', entityId: row.id, op: 'archive', before: null, after: null },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await isUndone(changeSetId)).toBe(false);
  });

  it('refuses a change set that touched a project', async () => {
    const org = await seedWorkspace();
    const project = await makeProject(org, 'Created');
    const changeSetId = await record(org, [
      { kind: 'project', id: project.id, op: 'create', after: { name: 'Created' } },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    const current = one(
      await db.select().from(schema.project).where(eq(schema.project.id, project.id)),
    );
    expect(current.archivedAt).toBeNull();
  });

  it('refuses to reverse a relation the change set removed', async () => {
    const org = await seedWorkspace();
    const blocking = await makeTask(org, 'Blocking');
    const blocked = await makeTask(org, 'Blocked');
    const changeSetId = await record(org, [
      { kind: 'blocks', from: blocking.id, to: blocked.id, linked: false },
    ]);

    await expect(changeSets.undoChangeSetAtomically(org.orgId, changeSetId)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      await db
        .select()
        .from(schema.taskDependency)
        .where(eq(schema.taskDependency.blockingTaskId, blocking.id)),
    ).toHaveLength(0);
  });
});
