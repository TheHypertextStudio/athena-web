/** `@docket/api` — the REST task change-set builders and the origin-stamped audit writer. */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { insertAuditEvents } from '../../src/lib/provenance/audit-events';
import { appProvenance, runWithProvenance } from '../../src/lib/provenance/context';
import {
  recordTaskReparents,
  relatedTaskLink,
  taskLabelsChange,
  taskUpdateChange,
} from '../../src/lib/provenance/task-change-sets';
import { getDb, seedTaskAccessOrg, seedTask } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

type TaskRow = typeof DbModule.task.$inferSelect;

/** A seeded org, its human actor, and a way to add tasks to it. */
interface SeededTask {
  readonly orgId: string;
  readonly actorId: string;
  readonly row: TaskRow;
  readonly addTask: (title: string) => Promise<TaskRow>;
}

async function seededTask(): Promise<SeededTask> {
  const { orgId, teamId, humanActorId, statusId } = await seedTaskAccessOrg(db, schema);
  const addTask = (title: string): Promise<TaskRow> =>
    seedTask(db, schema, statusId, { organizationId: orgId, teamId, title, state: 'todo' });
  return { orgId, actorId: humanActorId, row: await addTask('Seeded'), addTask };
}

describe('taskUpdateChange', () => {
  it('returns null when only untracked fields or equal dates differ', async () => {
    const { row } = await seededTask();
    const due = new Date('2026-09-01T00:00:00.000Z');
    const before = { ...row, dueDate: due };
    const after = { ...row, dueDate: new Date(due.getTime()), updatedAt: new Date() };

    expect(taskUpdateChange({ before, after })).toBeNull();
  });

  it('returns the tracked snapshots when a tracked field moved', async () => {
    const { row } = await seededTask();
    const change = taskUpdateChange({ before: row, after: { ...row, title: 'Renamed' } });

    expect(change?.op).toBe('update');
    expect(change?.before?.['title']).toBe('Seeded');
    expect(change?.after?.['title']).toBe('Renamed');
  });
});

describe('taskLabelsChange', () => {
  it('returns null for the same set in another order', () => {
    expect(taskLabelsChange('task_1', ['b', 'a'], ['a', 'b'])).toBeNull();
  });

  it('records a changed set sorted on both sides', () => {
    const change = taskLabelsChange('task_1', ['b'], ['c', 'a']);

    expect(change?.kind).toBe('task_labels');
    expect(change?.before).toEqual({ labelIds: ['b'] });
    expect(change?.after).toEqual({ labelIds: ['a', 'c'] });
  });
});

describe('relatedTaskLink', () => {
  it('stores the edge under the same endpoint order from either side', () => {
    expect(relatedTaskLink('b', 'a', true)).toEqual(relatedTaskLink('a', 'b', true));
    expect(relatedTaskLink('b', 'a', false)).toMatchObject({ from: 'a', to: 'b', linked: false });
  });
});

describe('recordTaskReparents', () => {
  it('records nothing for an empty batch or a batch whose tasks are gone', async () => {
    const { orgId, actorId } = await seededTask();

    await runWithProvenance(appProvenance(), async () => {
      expect(await recordTaskReparents(orgId, actorId, [])).toBeNull();
      expect(
        await recordTaskReparents(orgId, actorId, [
          { taskId: 'task_missing', previousParentTaskId: null, parentTaskId: null },
        ]),
      ).toBeNull();
    });
  });

  it('names a single move in its summary', async () => {
    const { orgId, actorId, row, addTask } = await seededTask();
    const parent = await addTask('Parent');

    const id = await runWithProvenance(appProvenance(), () =>
      recordTaskReparents(orgId, actorId, [
        { taskId: row.id, previousParentTaskId: null, parentTaskId: parent.id },
      ]),
    );

    expect(id).not.toBeNull();
    const [set] = await db
      .select({ summary: schema.changeSet.summary })
      .from(schema.changeSet)
      .where(eq(schema.changeSet.id, id ?? ''));
    expect(set?.summary).toBe('Moved 1 task');
  });
});

describe('insertAuditEvents', () => {
  it('writes a single row with a null origin outside any provenance scope', async () => {
    const { orgId, actorId, row } = await seededTask();

    await insertAuditEvents(db, 'sync_conflict', {
      organizationId: orgId,
      actorId,
      subjectType: 'task',
      subjectId: row.id,
      type: 'updated',
      metadata: {},
    });

    const [written] = await db
      .select({ origin: schema.auditEvent.origin })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, row.id));
    expect(written?.origin).toBeNull();
  });

  it('writes nothing for an empty list', async () => {
    await expect(insertAuditEvents(db, 'noop', [])).resolves.toBeUndefined();
  });
});
